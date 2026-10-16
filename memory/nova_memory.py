import sqlite3
import sys
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path


def default_db_path():
    """Keep writable user data beside the frozen app, not in PyInstaller internals."""
    if getattr(sys, "frozen", False):
        base_dir = Path(sys.executable).resolve().parent
    else:
        base_dir = Path(__file__).resolve().parent.parent
    return base_dir / "memory" / "nova_memory.db"


class NovaMemory:
    def __init__(self, db_path=None):
        self.db_path = Path(db_path) if db_path is not None else default_db_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._create_database()

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.db_path)
        try:
            db.execute("PRAGMA foreign_keys = ON")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _create_database(self):
        with self._connect() as db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    memory TEXT NOT NULL,
                    category TEXT DEFAULT 'general',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            db.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)

            db.execute("""
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT 'New chat',
                    pinned INTEGER NOT NULL DEFAULT 0,
                    archived INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            db.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id TEXT NOT NULL REFERENCES chat_sessions(id)
                        ON DELETE CASCADE,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            db.execute(
                "CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id "
                "ON chat_messages(chat_id, id)"
            )
            db.commit()

    def create_chat(self, chat_id, title="New chat"):
        now = datetime.now().isoformat(timespec="seconds")
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO chat_sessions (id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (chat_id, title.strip() or "New chat", now, now),
            )

    def list_chats(self, query=None, include_archived=False):
        conditions = []
        values = []
        if not include_archived:
            conditions.append("s.archived = 0")
        if query:
            conditions.append(
                "(LOWER(s.title) LIKE ? OR EXISTS ("
                "SELECT 1 FROM chat_messages m WHERE m.chat_id = s.id "
                "AND LOWER(m.content) LIKE ?))"
            )
            term = f"%{query.strip().lower()}%"
            values.extend((term, term))

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        with self._connect() as db:
            rows = db.execute(
                f"""
                SELECT s.id, s.title, s.pinned, s.archived, s.created_at,
                       s.updated_at,
                       (SELECT content FROM chat_messages m
                        WHERE m.chat_id = s.id AND m.role = 'user'
                        ORDER BY m.id DESC LIMIT 1) AS last_message
                FROM chat_sessions s
                {where}
                ORDER BY s.pinned DESC, s.updated_at DESC
                """,
                values,
            ).fetchall()

        return [
            {
                "id": row[0],
                "title": row[1],
                "pinned": bool(row[2]),
                "archived": bool(row[3]),
                "created_at": row[4],
                "updated_at": row[5],
                "last_message": row[6] or "",
            }
            for row in rows
        ]

    def get_chat(self, chat_id):
        with self._connect() as db:
            session = db.execute(
                """
                SELECT id, title, pinned, archived, created_at, updated_at
                FROM chat_sessions WHERE id = ?
                """,
                (chat_id,),
            ).fetchone()
            if session is None:
                return None
            messages = db.execute(
                """
                SELECT id, role, content, created_at
                FROM chat_messages WHERE chat_id = ? ORDER BY id
                """,
                (chat_id,),
            ).fetchall()

        return {
            "id": session[0],
            "title": session[1],
            "pinned": bool(session[2]),
            "archived": bool(session[3]),
            "created_at": session[4],
            "updated_at": session[5],
            "messages": [
                {
                    "id": row[0],
                    "role": row[1],
                    "content": row[2],
                    "created_at": row[3],
                }
                for row in messages
            ],
        }

    def save_chat_message(self, chat_id, role, content):
        if role not in {"user", "assistant"}:
            raise ValueError("Chat message role must be user or assistant.")
        now = datetime.now().isoformat(timespec="seconds")
        with self._connect() as db:
            cursor = db.execute(
                "INSERT INTO chat_messages (chat_id, role, content, created_at) "
                "VALUES (?, ?, ?, ?)",
                (chat_id, role, content, now),
            )
            if role == "user":
                has_prior_user = db.execute(
                    "SELECT 1 FROM chat_messages "
                    "WHERE chat_id = ? AND role = 'user' AND id != ? LIMIT 1",
                    (chat_id, cursor.lastrowid),
                ).fetchone()
                if not has_prior_user:
                    title = " ".join(content.split())[:60] or "New chat"
                    db.execute(
                        "UPDATE chat_sessions SET title = ? WHERE id = ?",
                        (title, chat_id),
                    )
            db.execute(
                "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
                (now, chat_id),
            )

    def update_chat(self, chat_id, *, title=None, pinned=None, archived=None):
        updates = []
        values = []
        if title is not None:
            clean_title = title.strip()
            if not clean_title:
                raise ValueError("Chat title cannot be empty.")
            updates.append("title = ?")
            values.append(clean_title[:100])
        if pinned is not None:
            updates.append("pinned = ?")
            values.append(int(pinned))
        if archived is not None:
            updates.append("archived = ?")
            values.append(int(archived))
        if not updates:
            return
        updates.append("updated_at = ?")
        values.append(datetime.now().isoformat(timespec="seconds"))
        values.append(chat_id)
        with self._connect() as db:
            db.execute(
                f"UPDATE chat_sessions SET {', '.join(updates)} WHERE id = ?",
                values,
            )

    def delete_chat(self, chat_id):
        with self._connect() as db:
            db.execute("DELETE FROM chat_sessions WHERE id = ?", (chat_id,))

    def update_memory(self, memory_id, memory, category="general"):
        clean_memory = memory.strip()
        if not clean_memory:
            raise ValueError("Memory cannot be empty.")
        now = datetime.now().isoformat(timespec="seconds")
        with self._connect() as db:
            db.execute(
                "UPDATE memories SET memory = ?, category = ?, updated_at = ? "
                "WHERE id = ?",
                (clean_memory, category.strip() or "general", now, memory_id),
            )

    def remember(self, memory, category="general"):
        now = datetime.now().isoformat(timespec="seconds")

        with self._connect() as db:
            db.execute(
                """
                INSERT INTO memories
                (memory, category, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (memory.strip(), category, now, now)
            )
            db.commit()

    def recall(self, query=None, limit=10):
        with self._connect() as db:
            if query:
                words = [
                    word.strip().lower()
                    for word in query.split()
                    if len(word.strip()) > 2
                ]

                if words:
                    conditions = []
                    values = []

                    for word in words:
                        conditions.append("LOWER(memory) LIKE ?")
                        values.append(f"%{word}%")

                    sql = f"""
                        SELECT id, memory, category, created_at
                        FROM memories
                        WHERE {" OR ".join(conditions)}
                        ORDER BY updated_at DESC
                        LIMIT ?
                    """

                    rows = db.execute(
                        sql,
                        (*values, limit)
                    ).fetchall()
                else:
                    rows = db.execute(
                        """
                        SELECT id, memory, category, created_at
                        FROM memories
                        ORDER BY updated_at DESC
                        LIMIT ?
                        """,
                        (limit,)
                    ).fetchall()
            else:
                rows = db.execute(
                    """
                    SELECT id, memory, category, created_at
                    FROM memories
                    ORDER BY updated_at DESC
                    LIMIT ?
                    """,
                    (limit,)
                ).fetchall()

        return rows

    def forget(self, memory_id):
        with self._connect() as db:
            db.execute(
                "DELETE FROM memories WHERE id = ?",
                (memory_id,)
            )
            db.commit()

    def clear_memories(self):
        with self._connect() as db:
            db.execute("DELETE FROM memories")
            db.commit()

    def save_message(self, role, content):
        now = datetime.now().isoformat(timespec="seconds")

        with self._connect() as db:
            db.execute(
                """
                INSERT INTO conversations
                (role, content, created_at)
                VALUES (?, ?, ?)
                """,
                (role, content, now)
            )
            db.commit()

    def recent_conversation(self, limit=10):
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT role, content, created_at
                FROM conversations
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,)
            ).fetchall()

        return list(reversed(rows))

    def format_memories(self, query=None, limit=10):
        memories = self.recall(query, limit)

        if not memories:
            return "No relevant memories."

        return "\n".join(
            f"- [{category}] {memory}"
            for _, memory, category, _ in memories
        )


if __name__ == "__main__":
    memory = NovaMemory()

    memory.remember(
        "NOVA was created by Subhadeep Roy (pronounced Subho-dip). Address the user as sir in every direct response.",
        "identity"
    )

    print("NOVA memory database initialized.")
    print()
    print("Current memories:")

    for row in memory.recall():
        print(row)
