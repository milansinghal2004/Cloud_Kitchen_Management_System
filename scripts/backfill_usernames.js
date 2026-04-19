const { Client } = require("pg");

async function run() {
  const databaseUrl = "postgresql://neondb_owner:npg_RUp4ZbhLa3Fk@ep-icy-water-amkd9clb-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
  if (!databaseUrl) {
    console.error("DATABASE_URL env var is required.");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const res = await client.query("SELECT id, name, email FROM users WHERE username IS NULL");
    console.log(`Found ${res.rows.length} users with NULL usernames. Starting backfill...`);

    for (const row of res.rows) {
      // Create a clean base username from email prefix or name
      const emailPrefix = (row.email || "").split("@")[0] || "";
      const nameBase = (row.name || "").toLowerCase().replace(/[^a-z0-9]/g, ".");
      let base = (emailPrefix || nameBase || "user").toLowerCase().replace(/[^a-z0-9]/g, ".");
      
      // Remove leading/trailing dots and double dots
      base = base.replace(/^\.+|\.+$/g, "").replace(/\.\.+/g, ".");
      if (!base) base = "user";

      let username = base;
      let counter = 1;

      // Ensure uniqueness within the loop
      while (true) {
        const check = await client.query(
          "SELECT id FROM users WHERE LOWER(username) = LOWER($1)",
          [username]
        );
        if (check.rows.length === 0) break;
        username = `${base}${counter++}`;
      }

      await client.query("UPDATE users SET username = $1 WHERE id = $2", [username, row.id]);
      console.log(`[FIXED] User ${row.id}: email=${row.email} -> username=${username}`);
    }

    console.log("Backfill complete.");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await client.end();
  }
}

run();
