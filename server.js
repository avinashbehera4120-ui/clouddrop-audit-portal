const express = require("express");
const multer = require("multer");
const mysql = require("mysql2/promise");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const crypto = require("crypto");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const PORT = process.env.PORT || 8080;
const DB_NAME = process.env.DB_NAME || "clouddrop";
const S3_BUCKET = process.env.S3_BUCKET || "";
const AWS_REGION = process.env.AWS_REGION || "ap-south-1";

const s3 = new S3Client({ region: AWS_REGION });

let dbPool = null;
let dbInitError = null;

async function initDatabase() {
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const port = Number(process.env.DB_PORT || 3306);

  if (!host || !user || !password) {
    dbInitError = "Database environment variables are not configured.";
    return;
  }

  try {
    const bootstrap = await mysql.createConnection({
      host, user, password, port, connectTimeout: 7000
    });

    await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    await bootstrap.end();

    dbPool = mysql.createPool({
      host,
      user,
      password,
      port,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: 7000
    });

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id VARCHAR(36) PRIMARY KEY,
        file_name VARCHAR(255) NOT NULL,
        s3_key VARCHAR(512) NOT NULL,
        file_size BIGINT NOT NULL,
        status VARCHAR(40) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    dbInitError = null;
    console.log("CloudDrop database initialized successfully.");
  } catch (err) {
    dbInitError = err.message;
    dbPool = null;
    console.error("Database initialization failed:", err.message);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "clouddrop-audit-portal" });
});

app.get("/api/status", async (req, res) => {
  let database = "not-configured";
  if (dbPool) {
    try {
      await dbPool.query("SELECT 1");
      database = "connected";
    } catch {
      database = "error";
    }
  } else if (dbInitError) {
    database = "error";
  }

  res.json({
    application: "online",
    database,
    s3: S3_BUCKET ? "configured" : "not-configured",
    region: AWS_REGION
  });
});

app.get("/api/events", async (req, res) => {
  if (!dbPool) {
    return res.json({ events: [], warning: "Database is not connected." });
  }

  try {
    const [rows] = await dbPool.query(`
      SELECT id, file_name AS fileName, s3_key AS s3Key,
             file_size AS fileSize, status, created_at AS createdAt
      FROM audit_events
      ORDER BY created_at DESC
      LIMIT 20
    `);
    res.json({ events: rows });
  } catch (err) {
    res.status(500).json({ error: "Unable to read audit events." });
  }
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Choose a file to upload." });
  }
  if (!S3_BUCKET) {
    return res.status(500).json({ error: "S3_BUCKET environment variable is not configured." });
  }

  const id = crypto.randomUUID();
  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `uploads/${Date.now()}-${id}-${safeName}`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || "application/octet-stream",
      Metadata: { auditid: id }
    }));

    if (dbPool) {
      await dbPool.execute(
        `INSERT INTO audit_events
          (id, file_name, s3_key, file_size, status)
         VALUES (?, ?, ?, ?, ?)`,
        [id, safeName, key, req.file.size, "UPLOADED"]
      );
    }

    res.status(201).json({
      id,
      fileName: safeName,
      s3Key: key,
      status: "UPLOADED",
      message: "File uploaded to S3. S3 will notify SNS, which fans out to SQS and Lambda."
    });
  } catch (err) {
    console.error("Upload failed:", err.message);
    res.status(500).json({ error: "Upload failed.", detail: err.message });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`CloudDrop Audit Portal listening on port ${PORT}`);
  await initDatabase();
});
