#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod control;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::ipc::{InvokeBody, Request, Response};

/// Paths travel in a header so the file bytes can go in the raw request body.
/// The frontend percent-encodes them because headers only carry ASCII.
fn header_path(request: &Request<'_>) -> Result<PathBuf, String> {
    let raw = request
        .headers()
        .get("x-path")
        .ok_or("caminho do arquivo ausente")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let decoded = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(decoded.as_ref()))
}

/// Writes next to the target first and renames, so a failed save never truncates the old file.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = header_path(&request)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("conteúdo do arquivo inválido".into());
    };
    write_atomic(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

fn main() {
    // `pontilha mcp`, `pontilha status`… talk to an open window instead of opening one.
    if cli::requested() {
        std::process::exit(cli::main());
    }

    let control_options = control::Options::from_args();
    let bridge = Arc::new(control::Bridge::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(bridge.clone())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            control::control_ready,
            control::control_reply,
            control::control_info,
        ])
        .setup(move |app| {
            if let Some(options) = control_options {
                match control::start(app.handle().clone(), bridge, options) {
                    Ok(port) => eprintln!("pontilha: controle em http://127.0.0.1:{port}"),
                    Err(e) => eprintln!("pontilha: controle desligado: {e}"),
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("falha ao iniciar o Pontilha")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                control::cleanup();
            }
        });
}
