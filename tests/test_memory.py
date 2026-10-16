import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from memory.nova_memory import NovaMemory


class NovaMemoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.memory = NovaMemory(Path(self.temporary_directory.name) / "test.db")

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_chat_history_is_scoped_and_searchable(self):
        self.memory.create_chat("chat-one")
        self.memory.create_chat("chat-two")
        self.memory.save_chat_message("chat-one", "user", "Plan a quiet weekend")
        self.memory.save_chat_message("chat-one", "assistant", "Try a local walk.")
        self.memory.save_chat_message("chat-two", "user", "Explain a Python list")

        chat = self.memory.get_chat("chat-one")
        self.assertEqual(chat["title"], "Plan a quiet weekend")
        self.assertEqual([item["role"] for item in chat["messages"]], ["user", "assistant"])
        self.assertEqual(
            [item["id"] for item in self.memory.list_chats(query="quiet")],
            ["chat-one"],
        )

    def test_chat_updates_archive_and_delete(self):
        self.memory.create_chat("chat-one")
        self.memory.update_chat("chat-one", title="Project notes", pinned=True)
        chat = self.memory.get_chat("chat-one")
        self.assertEqual(chat["title"], "Project notes")
        self.assertTrue(chat["pinned"])

        self.memory.update_chat("chat-one", archived=True)
        self.assertEqual(self.memory.list_chats(), [])
        self.assertEqual(len(self.memory.list_chats(include_archived=True)), 1)

        self.memory.delete_chat("chat-one")
        self.assertIsNone(self.memory.get_chat("chat-one"))

    def test_memory_can_be_updated_and_deleted(self):
        self.memory.remember("Prefers concise examples", "preferences")
        memory_id = self.memory.recall()[0][0]
        self.memory.update_memory(memory_id, "Prefers concise Python examples", "style")
        self.assertEqual(self.memory.recall()[0][1:3], ("Prefers concise Python examples", "style"))

        self.memory.forget(memory_id)
        self.assertEqual(self.memory.recall(), [])

    def test_frozen_app_stores_database_beside_executable(self):
        with patch("memory.nova_memory.sys.frozen", True, create=True), patch(
            "memory.nova_memory.sys.executable", r"C:\NOVA\dist\NOVA\NOVA.exe"
        ):
            memory = NovaMemory()
        self.assertEqual(memory.db_path, Path(r"C:\NOVA\dist\NOVA\memory\nova_memory.db"))


if __name__ == "__main__":
    unittest.main()
