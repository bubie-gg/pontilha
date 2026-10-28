//! Local control port for scripts and agents.
//!
//! `POST /rpc` with `Authorization: Bearer <token>` and a JSON body
//! `{"method": "...", "params": {...}}` runs one command in the open window and
//! answers `{"ok": true, "result": ...}` or `{"ok": false, "error": "..."}`.
//! The server only listens on 127.0.0.1. Its port and token file are published
//! in `~/.config/pontilha/control.json` so the Python client can find it.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

pub const DEFAULT_PORT: u16 = 7990;
const PORT_ATTEMPTS: u16 = 10;
const REPLY_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_BODY: u64 = 64 * 1024 * 1024;

/// Requests waiting for the webview to answer.
#[derive(Default)]
pub struct Bridge {
    pending: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    next_id: AtomicU64,
    ready: AtomicBool,
    port: AtomicU16,
}

pub struct Options {
    pub port: u16,
    pub token_file: PathBuf,
}

impl Options {
    /// `--control <port>`, `--control-token-file <path>` and `--no-control`.
    /// The port is on by default so scripts can always reach a running app.
    pub fn from_args() -> Option<Self> {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let mut port = std::env::var("PONTILHA_CONTROL_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_PORT);
        let mut token_file = config_dir().join("control.token");
        let mut i = 0;
        while i < args.len() {
            match args[i].as_str() {
                "--no-control" => return None,
                "--control" => {
                    if let Some(v) = args.get(i + 1).and_then(|v| v.parse().ok()) {
                        port = v;
                        i += 1;
                    }
                }
                "--control-token-file" => {
                    if let Some(v) = args.get(i + 1) {
                        token_file = PathBuf::from(v);
                        i += 1;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        Some(Self { port, token_file })
    }
}

pub fn config_dir() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("pontilha")
}

pub fn state_file() -> PathBuf {
    config_dir().join("control.json")
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)
}

/// Reuses the token in `path`, or creates a random one readable only by the user.
fn load_or_create_token(path: &Path) -> std::io::Result<String> {
    if let Ok(existing) = std::fs::read_to_string(path) {
        let token = existing.trim();
        if token.len() >= 16 {
            return Ok(token.to_string());
        }
    }
    let mut bytes = [0u8; 24];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    write_private(path, token.as_bytes())?;
    Ok(token)
}

fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn respond(request: tiny_http::Request, status: u16, body: &Value) {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..])
        .expect("static header");
    let response = tiny_http::Response::from_data(serde_json::to_vec(body).unwrap_or_default())
        .with_status_code(status)
        .with_header(header);
    let _ = request.respond(response);
}

fn error(message: &str) -> Value {
    json!({ "ok": false, "error": message })
}

fn handle(app: &AppHandle, bridge: &Bridge, token: &str, mut request: tiny_http::Request) {
    let method = request.method().clone();
    let path = request.url().split('?').next().unwrap_or("").to_string();

    match (&method, path.as_str()) {
        (tiny_http::Method::Get, "/health") => {
            let body = json!({
                "app": "pontilha",
                "version": env!("CARGO_PKG_VERSION"),
                "ready": bridge.ready.load(Ordering::SeqCst),
            });
            respond(request, 200, &body);
        }
        (tiny_http::Method::Post, "/rpc") => {
            let authorized = request.headers().iter().any(|h| {
                h.field.equiv("Authorization")
                    && same_secret(h.value.as_str().strip_prefix("Bearer ").unwrap_or(""), token)
            });
            if !authorized {
                return respond(request, 401, &error("token inválido ou ausente"));
            }
            let mut body = String::new();
            if request.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
                return respond(request, 400, &error("corpo da requisição ilegível"));
            }
            let call: Value = match serde_json::from_str(&body) {
                Ok(v) => v,
                Err(e) => return respond(request, 400, &error(&format!("JSON inválido: {e}"))),
            };
            let Some(name) = call.get("method").and_then(Value::as_str) else {
                return respond(request, 400, &error("o campo method está ausente"));
            };
            if !bridge.ready.load(Ordering::SeqCst) {
                return respond(request, 503, &error("o Pontilha ainda está carregando, tente de novo"));
            }

            let id = bridge.next_id.fetch_add(1, Ordering::SeqCst) + 1;
            let (tx, rx) = mpsc::channel();
            bridge.pending.lock().unwrap().insert(id, tx);
            let payload = json!({
                "id": id,
                "method": name,
                "params": call.get("params").cloned().unwrap_or_else(|| json!({})),
            });
            if let Err(e) = app.emit("control://request", payload) {
                bridge.pending.lock().unwrap().remove(&id);
                return respond(request, 500, &error(&format!("falha ao falar com a janela: {e}")));
            }
            match rx.recv_timeout(REPLY_TIMEOUT) {
                Ok(reply) => respond(request, 200, &reply),
                Err(_) => {
                    bridge.pending.lock().unwrap().remove(&id);
                    respond(request, 504, &error("a janela do Pontilha não respondeu a tempo"));
                }
            }
        }
        _ => respond(request, 404, &error("rota desconhecida; use POST /rpc ou GET /health")),
    }
}

/// Starts the control server on the first free port from `options.port`.
pub fn start(app: AppHandle, bridge: Arc<Bridge>, options: Options) -> Result<u16, String> {
    let token = load_or_create_token(&options.token_file).map_err(|e| format!("token: {e}"))?;
    let (server, port) = (0..PORT_ATTEMPTS)
        .find_map(|offset| {
            let port = options.port.checked_add(offset)?;
            tiny_http::Server::http(("127.0.0.1", port)).ok().map(|s| (s, port))
        })
        .ok_or_else(|| format!("nenhuma porta livre entre {} e {}", options.port, options.port + PORT_ATTEMPTS - 1))?;

    bridge.port.store(port, Ordering::SeqCst);
    let info = json!({
        "app": "pontilha",
        "version": env!("CARGO_PKG_VERSION"),
        "port": port,
        "pid": std::process::id(),
        "token_file": options.token_file,
    });
    write_private(&state_file(), &serde_json::to_vec_pretty(&info).unwrap_or_default())
        .map_err(|e| format!("{}: {e}", state_file().display()))?;

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let app = app.clone();
            let bridge = bridge.clone();
            let token = token.clone();
            std::thread::spawn(move || handle(&app, &bridge, &token, request));
        }
    });
    Ok(port)
}

/// Removes the published state file if it still points at this process.
pub fn cleanup() {
    let path = state_file();
    let ours = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|v| v.get("pid").and_then(Value::as_u64))
        == Some(u64::from(std::process::id()));
    if ours {
        let _ = std::fs::remove_file(path);
    }
}

#[tauri::command]
pub fn control_ready(bridge: tauri::State<'_, Arc<Bridge>>) {
    bridge.ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn control_reply(bridge: tauri::State<'_, Arc<Bridge>>, id: u64, response: Value) {
    if let Some(tx) = bridge.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(response);
    }
}

#[tauri::command]
pub fn control_info(bridge: tauri::State<'_, Arc<Bridge>>) -> Value {
    let port = bridge.port.load(Ordering::SeqCst);
    json!({ "port": if port == 0 { Value::Null } else { json!(port) } })
}
