use ndarray::{Array1, Array2};
use rusqlite::{params_from_iter, Connection};
use std::cmp::Ordering;
use std::fs;

fn get_top_n(v: &[f32], vectors: &[Vec<f32>], top_n: usize) -> Result<Vec<usize>, String> {
    if v.is_empty() {
        return Err("Query embedding must not be empty".to_string());
    }
    if vectors.iter().any(|vector| vector.len() != v.len()) {
        return Err("Stored embedding dimension does not match query embedding".to_string());
    }

    let n = vectors.len();
    let d = v.len();
    let flattened_vectors = vectors.iter().flatten().copied().collect();
    let a = Array2::from_shape_vec((n, d), flattened_vectors)
        .map_err(|error| format!("Invalid stored embeddings: {}", error))?;
    let b = Array1::from_vec(v.to_vec());

    let result = a.dot(&b);
    let mut indexed_result: Vec<(usize, &f32)> = result.iter().enumerate().collect();
    indexed_result.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(Ordering::Equal));

    let top_n_indices: Vec<usize> = indexed_result
        .into_iter()
        .map(|(index, _value)| index)
        .take(top_n)
        .collect();

    Ok(top_n_indices)
}

#[derive(Debug, Clone)]
pub struct Chunk {
    pub hash: String,
    pub content: String,
    pub embedding: Vec<f32>,
    pub start_line: usize,
    pub end_line: usize,
    pub file_path: String,
    pub index: usize,
}

pub fn embedding_to_text(embedding: Vec<f32>) -> String {
    return embedding
        .iter()
        .map(|f| f.to_string())
        .collect::<Vec<String>>()
        .join(",");
}

pub fn text_to_embedding(text: String) -> Result<Vec<f32>, &'static str> {
    let mut embedding = Vec::new();
    for s in text.split(',') {
        match s.parse::<f32>() {
            Ok(value) => embedding.push(value),
            Err(_) => {
                println!("Failed to parse embedding from text: {}", text);
                return Err("Failed to parse embedding from text");
            }
        }
    }

    Ok(embedding)
}

fn get_conn() -> Result<Connection, String> {
    let home_dir = dirs::home_dir().ok_or("Could not determine the home directory")?;
    let path = home_dir.join(".continue").join("index").join("sync.db");
    let parent = path
        .parent()
        .ok_or("Could not determine the sync database directory")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create sync database directory: {}", error))?;
    Connection::open(path).map_err(|error| format!("Failed to open sync database: {}", error))
}

pub fn create_database() -> Result<(), String> {
    let conn = get_conn()?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS chunks (
            id    INTEGER PRIMARY KEY,
            hash TEXT NOT NULL,
            content  TEXT NOT NULL,
            embedding TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            idx INTEGER NOT NULL
        )",
        (),
    )
    .map_err(|error| format!("Failed to create chunks table: {}", error))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS tags (
            id    INTEGER PRIMARY KEY,
            chunk_hash TEXT NOT NULL,
            tag  TEXT NOT NULL
        )",
        (),
    )
    .map_err(|error| format!("Failed to create tags table: {}", error))?;

    Ok(())
}

pub fn add_chunk(chunk: Chunk, tags: Vec<String>) -> Result<(), String> {
    let mut conn = get_conn()?;
    let transaction = conn
        .transaction()
        .map_err(|error| format!("Failed to start chunk transaction: {}", error))?;

    transaction.execute(
        "INSERT INTO chunks (hash, content, embedding, start_line, end_line, file_path, idx) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (&chunk.hash, &chunk.content, &embedding_to_text(chunk.embedding), chunk.start_line, chunk.end_line, &chunk.file_path, chunk.index),
    )
    .map_err(|error| format!("Failed to add chunk: {}", error))?;

    for tag in tags {
        transaction
            .execute(
                "INSERT INTO tags (chunk_hash, tag) VALUES (?1, ?2)",
                (&chunk.hash, &tag),
            )
            .map_err(|error| format!("Failed to add chunk tag: {}", error))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("Failed to commit chunk transaction: {}", error))
}

pub fn remove_chunks_for_hash(hash: String) -> Result<(), String> {
    let mut conn = get_conn()?;
    let transaction = conn
        .transaction()
        .map_err(|error| format!("Failed to start removal transaction: {}", error))?;

    transaction
        .execute("DELETE FROM chunks WHERE hash=?1", (&hash,))
        .map_err(|error| format!("Failed to remove chunks: {}", error))?;

    transaction
        .execute("DELETE FROM tags WHERE chunk_hash=?1", (&hash,))
        .map_err(|error| format!("Failed to remove chunk tags: {}", error))?;

    transaction
        .commit()
        .map_err(|error| format!("Failed to commit removal transaction: {}", error))
}

pub fn add_tag(hash: String, tag: String) -> Result<(), String> {
    let conn = get_conn()?;

    conn.execute(
        "INSERT INTO tags (chunk_hash, tag) VALUES (?1, ?2)",
        (&hash, &tag),
    )
    .map_err(|error| format!("Failed to add tag: {}", error))?;

    Ok(())
}

pub fn remove_tag(hash: String, tag: String) -> Result<(), String> {
    let conn = get_conn()?;

    conn.execute(
        "DELETE FROM tags WHERE chunk_hash=?1 AND tag=?2",
        (&hash, &tag),
    )
    .map_err(|error| format!("Failed to remove tag: {}", error))?;

    Ok(())
}

/// Apply all database changes produced by a sync as one SQLite transaction so
/// an interruption cannot leave chunk rows and tag rows out of sync.
pub fn apply_sync_changes(
    hashes_to_remove: &[String],
    hashes_to_tag: &[String],
    hashes_to_untag: &[String],
    tag: &str,
) -> Result<(), String> {
    let mut conn = get_conn()?;
    let transaction = conn
        .transaction()
        .map_err(|error| format!("Failed to start sync transaction: {}", error))?;

    for hash in hashes_to_remove {
        transaction
            .execute("DELETE FROM chunks WHERE hash=?1", (hash,))
            .map_err(|error| format!("Failed to remove chunks: {}", error))?;
        transaction
            .execute("DELETE FROM tags WHERE chunk_hash=?1", (hash,))
            .map_err(|error| format!("Failed to remove chunk tags: {}", error))?;
    }
    for hash in hashes_to_tag {
        transaction
            .execute(
                "INSERT INTO tags (chunk_hash, tag) VALUES (?1, ?2)",
                (hash, tag),
            )
            .map_err(|error| format!("Failed to add chunk tag: {}", error))?;
    }
    for hash in hashes_to_untag {
        transaction
            .execute(
                "DELETE FROM tags WHERE chunk_hash=?1 AND tag=?2",
                (hash, tag),
            )
            .map_err(|error| format!("Failed to remove chunk tag: {}", error))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("Failed to commit sync transaction: {}", error))
}

pub fn retrieve(n: usize, tags: Vec<String>, v: Vec<f32>) -> Result<Vec<Chunk>, String> {
    if n == 0 || tags.is_empty() {
        return Ok(Vec::new());
    }

    let conn = get_conn()?;
    let placeholders = std::iter::repeat("?")
        .take(tags.len())
        .collect::<Vec<_>>()
        .join(", ");

    let mut stmt = conn
        .prepare(&format!(
            "
        SELECT * FROM chunks
        WHERE hash IN (
            SELECT chunk_hash
            FROM tags
            WHERE tag IN ({})
        )",
            placeholders
        ))
        .map_err(|error| format!("Failed to prepare chunk retrieval: {}", error))?;
    let mut chunk_rows = stmt
        .query(params_from_iter(tags.iter()))
        .map_err(|error| format!("Failed to query chunks: {}", error))?;

    let mut chunks = Vec::new();
    let mut vectors: Vec<Vec<f32>> = Vec::new();
    while let Some(row) = chunk_rows
        .next()
        .map_err(|error| format!("Failed to read chunk: {}", error))?
    {
        let embedding_text: String = row
            .get(3)
            .map_err(|error| format!("Failed to load chunk embedding: {}", error))?;
        let embedding = text_to_embedding(embedding_text).map_err(|error| error.to_string())?;
        let chunk = Chunk {
            hash: row
                .get(1)
                .map_err(|error| format!("Failed to load chunk hash: {}", error))?,
            content: row
                .get(2)
                .map_err(|error| format!("Failed to load chunk content: {}", error))?,
            embedding,
            start_line: row
                .get(4)
                .map_err(|error| format!("Failed to load chunk start line: {}", error))?,
            end_line: row
                .get(5)
                .map_err(|error| format!("Failed to load chunk end line: {}", error))?,
            file_path: row
                .get(6)
                .map_err(|error| format!("Failed to load chunk filepath: {}", error))?,
            index: row
                .get(7)
                .map_err(|error| format!("Failed to load chunk index: {}", error))?,
        };
        chunks.push(chunk.clone());
        let vector = chunk.embedding;
        vectors.push(vector);
    }

    let top_n_indices = get_top_n(&v, &vectors, n)?;
    Ok(chunks
        .iter()
        .cloned()
        .enumerate()
        .filter(|(index, _chunk)| top_n_indices.contains(index))
        .map(|(_index, chunk)| chunk)
        .collect::<Vec<Chunk>>())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::{Array1, Array2};
    use rand::Rng;
    use rusqlite::Connection;
    use std::time::Instant;

    fn rand_embedding(n: i32) -> Vec<f32> {
        let mut rng = rand::thread_rng();
        (0..n).map(|_| rng.gen()).collect()
    }

    #[test]
    fn ranks_embeddings_with_the_query_dimension() {
        let query = vec![1.0, 0.0, 0.0];
        let vectors = vec![vec![0.0, 1.0, 0.0], vec![2.0, 0.0, 0.0]];

        assert_eq!(get_top_n(&query, &vectors, 1).unwrap(), vec![1]);
    }

    #[test]
    fn rejects_embeddings_with_mismatched_dimensions() {
        let query = vec![1.0, 0.0, 0.0];
        let vectors = vec![vec![1.0, 0.0]];

        assert!(get_top_n(&query, &vectors, 1).is_err());
    }

    #[test]
    fn test_create_database() {
        create_database().unwrap();

        let conn = get_conn().unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap();
        let mut table_names = stmt
            .query_map([], |row| row.get::<usize, String>(0))
            .unwrap();

        assert!(table_names.any(|table_name| table_name.unwrap().eq("chunks")));
        assert!(table_names.any(|table_name| table_name.unwrap().eq("tags")))
    }

    #[test]
    fn benchmark_load_vectors() {
        let conn = Connection::open("sync.db").unwrap();

        conn.execute(
            "CREATE TABLE chunks (
            id    INTEGER PRIMARY KEY,
            content  TEXT NOT NULL,
            embedding TEXT NOT NULL
        )",
            (), // empty list of parameters.
        )
        .unwrap();

        let time = Instant::now();

        for _ in 0..10_000 {
            let chunk = Chunk {
                hash: "test".to_string(),
                content: "Test content".to_string(),
                embedding: rand_embedding(384),
                start_line: 0,
                end_line: 0,
                file_path: "test".to_string(),
                index: 0,
            };
            conn.execute(
                "INSERT INTO chunks (content, embedding) VALUES (?1, ?2)",
                (&chunk.content, &embedding_to_text(chunk.embedding)),
            )
            .unwrap();
        }

        println!("To insert took: {:.2?}", time.elapsed());

        let mut stmt = conn
            .prepare("SELECT id, content, embedding FROM chunks")
            .unwrap();

        let chunk_iter = stmt
            .query_map([], |row| {
                Ok(Chunk {
                    hash: row.get(1)?,
                    content: row.get(2)?,
                    embedding: text_to_embedding(row.get(3)?).unwrap(),
                    start_line: row.get(4)?,
                    end_line: row.get(5)?,
                    file_path: row.get(6)?,
                    index: row.get(7)?,
                })
            })
            .unwrap();

        println!("To load took: {:.2?}", time.elapsed());

        let mut i = 0;
        for chunk in chunk_iter {
            i += 1;
            let _ = chunk.unwrap().embedding;
        }

        println!("Found {} chunks", i);
        println!("To convert took: {:.2?}", time.elapsed());
    }

    #[test]
    fn benchmark_ndarray() {
        let mut rng = rand::thread_rng();
        let n = 10_000;
        let d = 384;
        let a: Array2<f32> = Array2::from_shape_fn((n, d), |_| rng.gen::<f32>());
        let b: Array1<f32> = Array1::from_shape_fn(d, |_| rng.gen::<f32>());

        let time = Instant::now();

        let result = a.dot(&b);
        let mut indexed_result: Vec<(usize, &f32)> = result.iter().enumerate().collect();
        indexed_result.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap());

        let top_n = 50;
        let _: Vec<usize> = indexed_result
            .into_iter()
            .map(|(index, _value)| index)
            .take(top_n)
            .collect();

        let elapsed = time.elapsed();
        println!("Elapsed time: {:.2?}", elapsed);
    }
}
