//! Command line and MCP server, in the style of the ArtCraft apps.
//!
//! `pontilha mcp` speaks MCP over stdio for agents; the other subcommands are for
//! terminals. Both drive the open window through its control port (see
//! `control.rs`). Files are read and written here, never by the window, and only
//! beneath the automation roots (the home folder by default).

use std::fs::File;
use std::io::{BufRead, Read, Write};
use std::net::TcpStream;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};

use crate::control;

const SUBCOMMANDS: &[&str] = &[
    "mcp", "open", "status", "commands", "run", "preview", "export", "save", "place", "help", "--help", "-h", "--version",
];

const DEFAULT_PACE: Duration = Duration::from_millis(150);

type Result<T> = std::result::Result<T, String>;

/// True when the command line asks for a subcommand instead of the window.
pub fn requested() -> bool {
    std::env::args().nth(1).is_some_and(|a| SUBCOMMANDS.contains(&a.as_str()))
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

// Control port client

fn http(port: u16, method: &str, path: &str, headers: &[(&str, String)], body: &[u8]) -> Result<Vec<u8>> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .map_err(|e| format!("não consegui falar com o Pontilha na porta {port} ({e}). O app está aberto?"))?;
    stream.set_read_timeout(Some(Duration::from_secs(90))).ok();
    let mut head = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    stream
        .write_all(head.as_bytes())
        .and_then(|_| stream.write_all(body))
        .map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("resposta incompleta do Pontilha")?;
    let header = String::from_utf8_lossy(&raw[..split]).to_ascii_lowercase();
    let body = raw[split + 4..].to_vec();
    if header.contains("transfer-encoding: chunked") {
        return Ok(dechunk(&body));
    }
    Ok(body)
}

fn dechunk(mut data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    while let Some(eol) = data.windows(2).position(|w| w == b"\r\n") {
        let size = usize::from_str_radix(String::from_utf8_lossy(&data[..eol]).trim(), 16).unwrap_or(0);
        if size == 0 || data.len() < eol + 2 + size {
            break;
        }
        out.extend_from_slice(&data[eol + 2..eol + 2 + size]);
        data = &data[(eol + 4 + size).min(data.len())..];
    }
    out
}

struct Client {
    port: u16,
    token: String,
}

impl Client {
    fn connect() -> Result<Self> {
        let state = std::fs::read(control::state_file())
            .map_err(|_| "o Pontilha não está aberto. Abra o app (pontilha open) e tente de novo.".to_string())?;
        let state: Value = serde_json::from_slice(&state).map_err(|e| format!("control.json inválido: {e}"))?;
        let port = state["port"].as_u64().ok_or("control.json sem porta")? as u16;
        let token_file = state["token_file"].as_str().ok_or("control.json sem token_file")?;
        let token = std::fs::read_to_string(token_file)
            .map_err(|e| format!("{token_file}: {e}"))?
            .trim()
            .to_string();
        Ok(Self { port, token })
    }

    fn ready(&self) -> bool {
        http(self.port, "GET", "/health", &[], b"")
            .ok()
            .and_then(|body| serde_json::from_slice::<Value>(&body).ok())
            .is_some_and(|v| v["ready"] == true)
    }

    fn call(&self, method: &str, params: Value) -> Result<Value> {
        let body = serde_json::to_vec(&json!({ "method": method, "params": params })).unwrap_or_default();
        let headers = [
            ("Authorization", format!("Bearer {}", self.token)),
            ("Content-Type", "application/json".to_string()),
        ];
        let bytes = http(self.port, "POST", "/rpc", &headers, &body)?;
        let reply: Value =
            serde_json::from_slice(&bytes).map_err(|e| format!("resposta inválida do Pontilha: {e}"))?;
        if reply["ok"] == true {
            Ok(reply["result"].clone())
        } else {
            Err(format!("{method}: {}", reply["error"].as_str().unwrap_or("erro desconhecido")))
        }
    }

    /// PNG bytes of the visible image (or one layer), enlarged by `scale`.
    fn png(&self, scale: u64, layer: Option<&Value>) -> Result<Vec<u8>> {
        let mut params = json!({ "scale": scale });
        if let Some(layer) = layer {
            params["layer"] = layer.clone();
        }
        let result = self.call("render.png", params)?;
        base64::engine::general_purpose::STANDARD
            .decode(result["png"].as_str().unwrap_or(""))
            .map_err(|e| format!("PNG inválido: {e}"))
    }

    /// Integer scale whose result fits in `max_side` pixels.
    fn fit_scale(&self, max_side: u64) -> Result<u64> {
        let info = self.call("doc.inspect", json!({}))?;
        let side = info["width"].as_u64().unwrap_or(1).max(info["height"].as_u64().unwrap_or(1));
        Ok((max_side / side).max(1))
    }
}

fn running() -> Option<Client> {
    Client::connect().ok().filter(Client::ready)
}

/// Opens the window if it is not open yet and waits until it accepts commands.
fn open_app() -> Result<Client> {
    if let Some(client) = running() {
        return Ok(client);
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let log_dir = home().join(".cache/pontilha");
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log = File::options()
        .create(true)
        .append(true)
        .open(log_dir.join("app.log"))
        .map_err(|e| e.to_string())?;
    let mut command = Command::new(exe);
    command
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log);
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    command.spawn().map_err(|e| format!("não consegui abrir o Pontilha: {e}"))?;

    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(30) {
        if let Some(client) = running() {
            return Ok(client);
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    Err(format!("o Pontilha não ficou pronto em 30 s; veja {}", log_dir.join("app.log").display()))
}

// Files

struct Roots {
    read: PathBuf,
    write: PathBuf,
}

impl Roots {
    fn from_args(args: &[String]) -> Self {
        let mut roots = Self { read: home(), write: home() };
        let mut i = 0;
        while i < args.len() {
            match (args[i].as_str(), args.get(i + 1)) {
                ("--automation-read-root", Some(v)) => {
                    roots.read = PathBuf::from(v);
                    i += 1;
                }
                ("--automation-write-root", Some(v)) => {
                    roots.write = PathBuf::from(v);
                    i += 1;
                }
                _ => {}
            }
            i += 1;
        }
        roots
    }
}

/// Resolves `path` (absolute, `~/…` or relative to `root`) and refuses anything outside `root`.
fn resolve(path: &str, root: &Path) -> Result<PathBuf> {
    let candidate = match path.strip_prefix("~/") {
        Some(rest) => home().join(rest),
        None if Path::new(path).is_absolute() => PathBuf::from(path),
        None => root.join(path),
    };
    if candidate.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("use um caminho sem '..': {path}"));
    }
    let root = root.canonicalize().map_err(|e| format!("{}: {e}", root.display()))?;
    let mut probe = candidate.as_path();
    while !probe.exists() {
        probe = probe.parent().ok_or_else(|| format!("caminho inválido: {path}"))?;
    }
    let real = probe.canonicalize().map_err(|e| format!("{}: {e}", probe.display()))?;
    if !real.starts_with(&root) {
        return Err(format!("{} fica fora da pasta permitida ({})", candidate.display(), root.display()));
    }
    Ok(candidate)
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, bytes)
        .and_then(|_| std::fs::rename(&tmp, path))
        .map_err(|e| format!("{}: {e}", path.display()))
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

fn file_name(path: &Path) -> String {
    path.file_name().and_then(|n| n.to_str()).unwrap_or("imagem").to_string()
}

/// How to export, beyond the format the extension picks.
struct Export {
    scale: u64,
    layer: Option<Value>,
    /// PNG only: every frame in one image, `row` or `grid`.
    sheet: Option<String>,
    /// GIF only: play forward, then back.
    pingpong: bool,
    /// Sheet and GIF: only this tag's frames (name or id).
    tag: Option<String>,
}

impl Export {
    fn scale(scale: u64) -> Self {
        Self { scale, layer: None, sheet: None, pingpong: false, tag: None }
    }
}

fn decode_base64(value: &Value, what: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(value.as_str().unwrap_or(""))
        .map_err(|e| format!("{what} inválido: {e}"))
}

/// Saves the project (`.pontilha`) or exports a PNG or GIF, picking by extension.
fn save_as(client: &Client, path: &Path, export: &Export) -> Result<Value> {
    let scale = export.scale;
    match extension(path).as_str() {
        "pontilha" => {
            let project = client.call("project.serialize", json!({}))?;
            write_file(path, project["text"].as_str().unwrap_or("").as_bytes())?;
            client.call("project.markSaved", json!({ "fileName": file_name(path) }))?;
            Ok(json!({ "saved": path, "format": "pontilha" }))
        }
        "png" if export.sheet.is_some() => {
            let mut params = json!({ "scale": scale, "layout": export.sheet });
            if let Some(tag) = &export.tag {
                params["tag"] = json!(tag);
            }
            let result = client.call("render.sheet", params)?;
            let png = decode_base64(&result["png"], "PNG")?;
            write_file(path, &png)?;
            Ok(json!({
                "saved": path, "format": "png", "sheet": export.sheet, "scale": scale,
                "columns": result["columns"], "rows": result["rows"],
                "frameWidth": result["frameWidth"], "frameHeight": result["frameHeight"],
                "durations": result["durations"], "bytes": png.len(),
            }))
        }
        "png" => {
            let png = client.png(scale, export.layer.as_ref())?;
            write_file(path, &png)?;
            Ok(json!({ "saved": path, "format": "png", "scale": scale, "bytes": png.len() }))
        }
        "gif" => {
            let mut params = json!({ "scale": scale, "pingpong": export.pingpong });
            if let Some(tag) = &export.tag {
                params["tag"] = json!(tag);
            }
            let result = client.call("render.gif", params)?;
            let gif = decode_base64(&result["gif"], "GIF")?;
            write_file(path, &gif)?;
            Ok(json!({
                "saved": path, "format": "gif", "scale": scale, "frames": result["frames"],
                "colors": result["colors"], "reduced": result["reduced"], "bytes": gif.len(),
            }))
        }
        other => Err(format!("formato .{other} não suportado; use .pontilha (projeto), .png ou .gif")),
    }
}

fn open_file(client: &Client, path: &Path, discard: bool) -> Result<Value> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let name = file_name(path);
    if extension(path) == "pontilha" {
        let text = String::from_utf8(bytes).map_err(|_| "o arquivo não é um projeto do Pontilha".to_string())?;
        client.call("project.load", json!({ "text": text, "fileName": name, "discard": discard }))
    } else {
        let png = base64::engine::general_purpose::STANDARD.encode(bytes);
        let project_name = path.with_extension("pontilha");
        client.call("image.load", json!({ "png": png, "fileName": file_name(&project_name), "discard": discard }))
    }
}

/// Adds a PNG file as a new layer, e.g. a reference drawn over at half opacity.
fn place_file(client: &Client, path: &Path, name: Option<Value>, x: i64, y: i64, opacity: f64) -> Result<Value> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Referência").to_string();
    client.call(
        "layer.import",
        json!({
            "png": base64::engine::general_purpose::STANDARD.encode(bytes),
            "name": name.unwrap_or(json!(stem)),
            "x": x,
            "y": y,
            "opacity": opacity,
        }),
    )
}

// MCP server

const INSTRUCTIONS: &str = "Pontilha is a pixel-art editor open on the user's screen; everything you do appears \
live in its window. Coordinates are image pixels, (0, 0) top-left, y down; colours are \"#rrggbb\". Every \
action is a command: find ids and parameters with command_list and run them with command_run, or several \
with command_batch (one undo step; if one fails nothing is applied). Typical flow: app_open if needed -> \
doc_new {width: 32, height: 32} -> command_run layer.new / draw.ellipse / draw.star / draw.pattern / \
effect.outline (draw commands take onlyOn to shade inside a colour) -> render_preview to look at the \
result -> doc_save (.pontilha keeps layers and frames) and doc_export (.png, or .gif for the animation; scale enlarges \
without blurring). Animation: frame.new {copy?} adds a frame after the current one and shows it; every draw command \
takes frame (number from 1) to paint any frame without switching; frame.setDuration sets milliseconds per frame. \
Looping motion without redrawing: anim.oscillate bobs a layer (phase delays an accessory behind the body), \
effect.wave {animate: true} ripples a hem, draw.particles floats dust on its own layer. Volume: effect.shade (light \
and dark sides by the edge), effect.bands (rings by distance to the edge), effect.blobify (melt shapes together). \
Finish with effect.posterize {preset} and check with color.check. recipe.start/stop records a piece; recipe.run \
{colors: {old: new}} replays it in other colours. \
doc_new refuses to drop unsaved work unless discard is true: ask the user first.";

fn schema(properties: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": properties, "required": required })
}

fn tools() -> Value {
    let step = json!({
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "Command id, e.g. `draw.ellipse`, `layer.new`." },
            "params": { "type": "object", "description": "Command parameters (see the params doc in command_list)." }
        },
        "required": ["id"]
    });
    json!([
        {
            "name": "app_open",
            "description": "Open the Pontilha window if it is not open yet and wait until it accepts commands. Returns doc_inspect.",
            "inputSchema": schema(json!({}), &[])
        },
        {
            "name": "command_list",
            "description": "List the commands: [{id, params, summary}]. `params` documents the parameters; `?` marks optional ones.",
            "inputSchema": schema(json!({ "filter": { "type": "string", "description": "Only commands whose id or summary contains this text." } }), &[])
        },
        {
            "name": "command_run",
            "description": "Run one command by id with JSON params (see command_list) in the open window. One undo step. Returns the command's JSON result.",
            "inputSchema": schema(json!({
                "id": { "type": "string", "description": "Command id, e.g. `draw.star`, `layer.setProps`." },
                "params": { "type": "object", "description": "Command parameters as a JSON object." }
            }), &["id"])
        },
        {
            "name": "command_batch",
            "description": "Run several commands in order as a single undo step. Atomic: if a step fails, every step is rolled back and the error names it. Returns {completed, failed, results:[{ok, result}]}.",
            "inputSchema": schema(json!({
                "steps": { "type": "array", "items": step, "description": "`[{\"id\": \"layer.new\", \"params\": {\"name\": \"base\"}}, ...]`" },
                "stop_on_error": { "type": "boolean", "description": "Accepted for compatibility; batches always stop and roll back on the first error." }
            }), &["steps"])
        },
        {
            "name": "doc_new",
            "description": "Create a new image (default 32x32, transparent). Refuses when the window has unsaved changes unless discard is true; ask the user before discarding.",
            "inputSchema": schema(json!({
                "width": { "type": "integer", "minimum": 1, "maximum": 2048 },
                "height": { "type": "integer", "minimum": 1, "maximum": 2048 },
                "name": { "type": "string" },
                "background": { "type": "string", "description": "transparent | #rrggbb" },
                "discard": { "type": "boolean" }
            }), &[])
        },
        {
            "name": "doc_open",
            "description": "Open a .pontilha project or a PNG in the window. Same discard rule as doc_new.",
            "inputSchema": schema(json!({
                "path": { "type": "string", "description": "Beneath the automation read root (home by default): absolute, ~/… or relative." },
                "discard": { "type": "boolean" }
            }), &["path"])
        },
        {
            "name": "doc_place",
            "description": "Place a PNG file as a new layer above the active one, at (x, y). For Bubie items, place the reference character at opacity 0.5 as `bubie_ref`.",
            "inputSchema": schema(json!({
                "path": { "type": "string", "description": "PNG beneath the automation read root (home by default)." },
                "name": { "type": "string", "description": "Layer name; default: the file name." },
                "x": { "type": "integer" },
                "y": { "type": "integer" },
                "opacity": { "type": "number", "minimum": 0, "maximum": 1 }
            }), &["path"])
        },
        {
            "name": "doc_save",
            "description": "Save the image. `.pontilha` is the native format (layers, palette); `.png` exports the visible image. Without path, writes back to the last project saved or opened here.",
            "inputSchema": schema(json!({
                "path": { "type": "string", "description": "Beneath the automation write root (home by default)." },
                "scale": { "type": "integer", "minimum": 1, "description": "PNG only: enlarge each pixel to scale x scale (nearest neighbour)." }
            }), &[])
        },
        {
            "name": "doc_export",
            "description": "Export the image. `.png`: the frame on screen (or one layer), or with `sheet` every frame in one sprite sheet. `.gif`: the whole animation, looping, with each frame's duration. `scale` enlarges without blurring (Bubie badges: 40 px drawn and delivered at scale 1; scale 4 for a preview).",
            "inputSchema": schema(json!({
                "path": { "type": "string", "description": "Target .png or .gif beneath the automation write root." },
                "scale": { "type": "integer", "minimum": 1 },
                "layer": { "type": "string", "description": "PNG of the frame on screen only: layer name or id; default: all visible layers." },
                "sheet": { "type": "string", "enum": ["row", "grid"], "description": "PNG only: every frame left to right in one row, or in a near-square grid." },
                "pingpong": { "type": "boolean", "description": "GIF only: play forward, then back." },
                "tag": { "type": "string", "description": "Sheet and GIF: only the frames of this tag (name or id)." }
            }), &["path"])
        },
        {
            "name": "doc_inspect",
            "description": "Document state as JSON: size, layers (top to bottom), active layer, frames with durations and the one on screen, colours, palette, unsaved changes and undo state.",
            "inputSchema": schema(json!({}), &[])
        },
        {
            "name": "render_preview",
            "description": "Render the visible image as a PNG, enlarged by an integer factor so its longest side fits max_side (default 512), to look at the work.",
            "inputSchema": schema(json!({
                "max_side": { "type": "integer", "minimum": 1, "maximum": 2048 },
                "layer": { "type": "string", "description": "Preview one layer instead of the whole image." }
            }), &[])
        }
    ])
}

fn text(value: Value) -> Vec<Value> {
    vec![json!({ "type": "text", "text": value.to_string() })]
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args[key].as_str().ok_or_else(|| format!("o argumento \"{key}\" é obrigatório"))
}

fn some(args: &Value, key: &str) -> Option<Value> {
    args.get(key).filter(|v| !v.is_null()).cloned()
}

struct Session {
    roots: Roots,
    /// Last project saved or opened through this server, for doc_save without a path.
    current: Option<PathBuf>,
}

impl Session {
    fn tool(&mut self, name: &str, args: &Value) -> Result<Vec<Value>> {
        if name == "app_open" {
            return Ok(text(open_app()?.call("doc.inspect", json!({}))?));
        }
        let client = Client::connect()?;
        match name {
            "command_list" => Ok(text(client.call("commands.list", json!({ "filter": some(args, "filter") }))?)),
            "command_run" => Ok(text(client.call(arg_str(args, "id")?, some(args, "params").unwrap_or(json!({})))?)),
            "command_batch" => {
                let steps = args["steps"].as_array().ok_or("steps precisa ser uma lista de {id, params}")?;
                let commands: Vec<Value> = steps
                    .iter()
                    .map(|s| json!({ "method": s["id"], "params": some(s, "params").unwrap_or(json!({})) }))
                    .collect();
                let results = client.call("batch", json!({ "commands": commands }))?;
                let results: Vec<Value> = results
                    .as_array()
                    .map(|list| list.iter().map(|r| json!({ "ok": true, "result": r })).collect())
                    .unwrap_or_default();
                Ok(text(json!({ "completed": results.len(), "failed": 0, "results": results })))
            }
            "doc_inspect" => Ok(text(client.call("doc.inspect", json!({}))?)),
            "doc_new" => {
                let width = args["width"].as_u64().unwrap_or(32);
                let height = args["height"].as_u64().unwrap_or(32);
                let mut params = json!({ "width": width, "height": height, "discard": args["discard"] == true });
                if let Some(name) = some(args, "name") {
                    params["name"] = name;
                }
                let mut info = client.call("doc.new", params)?;
                if let Some(bg) = args["background"].as_str().filter(|b| *b != "transparent") {
                    client.call(
                        "draw.rect",
                        json!({ "x": 0, "y": 0, "w": width, "h": height, "color": bg, "filled": true }),
                    )?;
                    info = client.call("doc.inspect", json!({}))?;
                }
                self.current = None;
                Ok(text(info))
            }
            "doc_open" => {
                let path = resolve(arg_str(args, "path")?, &self.roots.read)?;
                let info = open_file(&client, &path, args["discard"] == true)?;
                self.current = (extension(&path) == "pontilha").then_some(path);
                Ok(text(info))
            }
            "doc_place" => {
                let path = resolve(arg_str(args, "path")?, &self.roots.read)?;
                let layer = place_file(
                    &client,
                    &path,
                    some(args, "name"),
                    args["x"].as_i64().unwrap_or(0),
                    args["y"].as_i64().unwrap_or(0),
                    args["opacity"].as_f64().unwrap_or(1.0),
                )?;
                Ok(text(layer))
            }
            "doc_save" => {
                let path = match args["path"].as_str() {
                    Some(p) => resolve(p, &self.roots.write)?,
                    None => self.current.clone().ok_or("informe path: esta imagem ainda não foi salva")?,
                };
                let result = save_as(&client, &path, &Export::scale(args["scale"].as_u64().unwrap_or(1)))?;
                if extension(&path) == "pontilha" {
                    self.current = Some(path);
                }
                Ok(text(result))
            }
            "doc_export" => {
                let path = resolve(arg_str(args, "path")?, &self.roots.write)?;
                if !matches!(extension(&path).as_str(), "png" | "gif") {
                    return Err("doc_export grava PNG ou GIF; use um caminho terminado em .png ou .gif".into());
                }
                let sheet = args["sheet"].as_str().map(str::to_string);
                if sheet.as_deref().is_some_and(|s| s != "row" && s != "grid") {
                    return Err("sheet precisa ser \"row\" ou \"grid\"".into());
                }
                let export = Export {
                    scale: args["scale"].as_u64().unwrap_or(1),
                    layer: some(args, "layer"),
                    sheet,
                    pingpong: args["pingpong"].as_bool().unwrap_or(false),
                    tag: args["tag"].as_str().map(str::to_string),
                };
                Ok(text(save_as(&client, &path, &export)?))
            }
            "render_preview" => {
                let scale = client.fit_scale(args["max_side"].as_u64().unwrap_or(512))?;
                let layer = some(args, "layer");
                let png = client.png(scale, layer.as_ref())?;
                let data = base64::engine::general_purpose::STANDARD.encode(png);
                Ok(vec![json!({ "type": "image", "data": data, "mimeType": "image/png" })])
            }
            other => Err(format!("ferramenta desconhecida: {other}")),
        }
    }
}

fn serve_mcp(roots: Roots) -> i32 {
    let mut session = Session { roots, current: None };
    let mut stdout = std::io::stdout();
    let mut send = |message: Value| {
        let _ = writeln!(stdout, "{message}");
        let _ = stdout.flush();
    };
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let message: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                send(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "JSON inválido" } }));
                continue;
            }
        };
        // Notifications (no id) need no answer.
        let Some(id) = message.get("id").filter(|v| !v.is_null()).cloned() else { continue };
        let params = message.get("params").cloned().unwrap_or(json!({}));
        let result = match message["method"].as_str().unwrap_or("") {
            "initialize" => json!({
                "protocolVersion": params["protocolVersion"].as_str().unwrap_or("2025-06-18"),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "pontilha", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            }),
            "ping" => json!({}),
            "tools/list" => json!({ "tools": tools() }),
            "tools/call" => {
                let name = params["name"].as_str().unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                match session.tool(name, &args) {
                    Ok(content) => json!({ "content": content }),
                    Err(e) => json!({ "content": [{ "type": "text", "text": format!("erro: {e}") }], "isError": true }),
                }
            }
            other => {
                send(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": format!("método desconhecido: {other}") }
                }));
                continue;
            }
        };
        send(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    }
    0
}

// Terminal commands

const USAGE: &str = "uso: pontilha [comando]

Sem comando, abre a janela. Com a janela aberta:

  open [ARQUIVO]             abre a janela (e um .pontilha ou .png nela)
  status                     o que está na imagem e se há alterações não salvas
  commands [filtro]          lista os comandos do motor
  run ID [JSON]              roda um comando: pontilha run draw.rect '{\"x\":0,\"y\":0,\"w\":4,\"h\":4}'
  run RECEITA.json [PAUSA]   roda os passos de um arquivo [{\"id\": ..., \"params\": ...}], ao vivo
  preview [ARQUIVO.png]      salva uma prévia ampliada (cerca de 512 px)
  export ARQUIVO.png [ESCALA] [row|grid]   quadro atual, ou todos numa folha de sprites
  export ARQUIVO.gif [ESCALA] [pingpong]   animação inteira, repetindo
                                           (folha e GIF: tag=NOME exporta só um trecho)
  save ARQUIVO.pontilha
  place ARQUIVO.png [OPACIDADE]  põe um PNG como camada nova (referência: 0.5)
  mcp                        servidor MCP para agentes (stdio)";

fn run_recipe(client: &Client, path: &Path, pace: Duration) -> Result<()> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let recipe: Value = serde_json::from_str(&text).map_err(|e| format!("{}: JSON inválido: {e}", path.display()))?;
    let steps = recipe.get("steps").unwrap_or(&recipe).as_array().ok_or("a receita precisa ser [{id, params}] ou {steps: [...]}")?;
    for (i, step) in steps.iter().enumerate() {
        let id = step["id"].as_str().ok_or_else(|| format!("passo {}: falta id", i + 1))?;
        client
            .call(id, some(step, "params").unwrap_or(json!({})))
            .map_err(|e| format!("passo {}: {e}", i + 1))?;
        println!("{:>3}/{} {id}", i + 1, steps.len());
        std::thread::sleep(pace);
    }
    Ok(())
}

fn terminal(args: &[String]) -> Result<()> {
    let command = args.first().map(String::as_str).unwrap_or("help");
    if matches!(command, "help" | "--help" | "-h") {
        println!("{USAGE}");
        return Ok(());
    }
    if command == "--version" {
        println!("pontilha {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if command == "open" {
        let client = open_app()?;
        match args.get(1) {
            Some(raw) => {
                let path = match raw.strip_prefix("~/") {
                    Some(rest) => home().join(rest),
                    None => std::env::current_dir().unwrap_or_else(|_| home()).join(raw),
                };
                let info = open_file(&client, &path, false)?;
                println!("{} aberto: {} × {} px", path.display(), info["width"], info["height"]);
            }
            None => println!("Pontilha aberto e pronto para comandos."),
        }
        return Ok(());
    }

    let client = Client::connect()?;
    let cwd = std::env::current_dir().unwrap_or_else(|_| home());
    let path_arg = |i: usize| -> Result<PathBuf> {
        let raw = args.get(i).ok_or_else(|| format!("faltou o arquivo.\n\n{USAGE}"))?;
        Ok(match raw.strip_prefix("~/") {
            Some(rest) => home().join(rest),
            None => cwd.join(raw),
        })
    };
    match command {
        "status" => {
            let info = client.call("doc.inspect", json!({}))?;
            let layers: Vec<String> = info["layers"]
                .as_array()
                .map(|l| {
                    l.iter()
                        .map(|x| {
                            let name = x["name"].as_str().unwrap_or("?");
                            if x["visible"] == true { name.to_string() } else { format!("{name} (oculta)") }
                        })
                        .collect()
                })
                .unwrap_or_default();
            println!(
                "Pontilha aberto na porta {}: {}, {} × {} px",
                client.port, info["fileName"].as_str().unwrap_or("?"), info["width"], info["height"]
            );
            println!("camadas, de cima para baixo: {}", layers.join(", "));
            println!("{}", if info["dirty"] == true { "alterações não salvas" } else { "tudo salvo" });
        }
        "commands" => {
            let list = client.call("commands.list", json!({ "filter": args.get(1) }))?;
            for c in list.as_array().into_iter().flatten() {
                println!(
                    "{}({})\n    {}",
                    c["id"].as_str().unwrap_or(""),
                    c["params"].as_str().unwrap_or(""),
                    c["summary"].as_str().unwrap_or("")
                );
            }
        }
        "run" => {
            let target = args.get(1).ok_or_else(|| format!("faltou o comando.\n\n{USAGE}"))?;
            if target.ends_with(".json") {
                let pace = args
                    .get(2)
                    .and_then(|s| s.parse::<f64>().ok())
                    .map(Duration::from_secs_f64)
                    .unwrap_or(DEFAULT_PACE);
                run_recipe(&client, &path_arg(1)?, pace)?;
            } else {
                let params = match args.get(2) {
                    Some(raw) => serde_json::from_str(raw).map_err(|e| format!("JSON inválido: {e}"))?,
                    None => json!({}),
                };
                println!("{:#}", client.call(target, params)?);
            }
        }
        "preview" => {
            let path = match args.get(1) {
                Some(_) => path_arg(1)?,
                None => std::env::temp_dir().join("pontilha-preview.png"),
            };
            let png = client.png(client.fit_scale(512)?, None)?;
            write_file(&path, &png)?;
            println!("{}", path.display());
        }
        "export" => {
            let path = path_arg(1)?;
            let path = if extension(&path) == "gif" { path } else { path.with_extension("png") };
            let mut export = Export::scale(1);
            for option in &args[2.min(args.len())..] {
                match option.as_str() {
                    "row" | "grid" => export.sheet = Some(option.clone()),
                    "pingpong" => export.pingpong = true,
                    t if t.starts_with("tag=") => export.tag = Some(t["tag=".len()..].to_string()),
                    n => export.scale = n.parse().map_err(|_| format!("opção desconhecida: {n} (use uma escala, row, grid, pingpong ou tag=NOME)"))?,
                }
            }
            println!("{:#}", save_as(&client, &path, &export)?);
        }
        "place" => {
            let path = path_arg(1)?;
            let opacity = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1.0);
            println!("{:#}", place_file(&client, &path, None, 0, 0, opacity)?);
        }
        "save" => {
            let path = path_arg(1)?;
            println!("{:#}", save_as(&client, &path.with_extension("pontilha"), &Export::scale(1))?);
        }
        other => return Err(format!("comando desconhecido: {other}\n\n{USAGE}")),
    }
    Ok(())
}

/// Runs the requested subcommand and returns the process exit code.
pub fn main() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("mcp") {
        return serve_mcp(Roots::from_args(&args[1..]));
    }
    match terminal(&args) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("erro: {e}");
            1
        }
    }
}
