// commands/ai.rs — Ask AI: lenguaje natural → SQL via Anthropic API

use serde_json::{json, Value};

/// Convierte lenguaje natural a SQL usando Claude.
/// El frontend pasa el api_key (recuperado del keychain) y el contexto del schema.
#[tauri::command]
pub async fn ask_ai(
    prompt: String,
    schema_context: String,
    api_key: String,
) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("Configura tu Anthropic API key primero.".to_string());
    }

    let system = format!(
        "Eres un experto en SQL. Tu única tarea es convertir descripciones en lenguaje natural \
         a queries SQL válidos y eficientes. Responde SOLO con el SQL, sin explicaciones, \
         sin bloques de código markdown, sin texto adicional. Solo SQL puro.\
         \n\nContexto del schema actual:\n{}",
        if schema_context.is_empty() { "No disponible".to_string() } else { schema_context }
    );

    let body = json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 1024,
        "system": system,
        "messages": [
            { "role": "user", "content": prompt }
        ]
    });

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Error de red: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, text));
    }

    let json: Value = response.json().await
        .map_err(|e| format!("Error parseando respuesta: {}", e))?;

    let sql = json["content"][0]["text"]
        .as_str()
        .ok_or("Respuesta vacía de la API")?
        .trim()
        .to_string();

    Ok(sql)
}
