import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import configure_gemini


class GeminiSetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.config_directory = Path(self.temporary_directory.name) / "config"
        self.secrets_file = self.config_directory / "secrets.json"
        self.prompt_marker = self.config_directory / ".gemini_setup_prompted"
        self.paths = (
            patch.object(configure_gemini, "CONFIG_DIR", self.config_directory),
            patch.object(configure_gemini, "SECRETS_FILE", self.secrets_file),
            patch.object(configure_gemini, "PROMPT_MARKER", self.prompt_marker),
        )
        for path_patch in self.paths:
            path_patch.start()
            self.addCleanup(path_patch.stop)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_key_is_hidden_and_saved_locally(self):
        output = io.StringIO()
        with patch.object(configure_gemini.getpass, "getpass", return_value="test-secret"), contextlib.redirect_stdout(output):
            configure_gemini.configure_gemini()

        self.assertEqual(json.loads(self.secrets_file.read_text(encoding="utf-8")), {"gemini_api_key": "test-secret"})
        self.assertTrue(self.prompt_marker.exists())
        self.assertNotIn("test-secret", output.getvalue())

    def test_empty_input_skips_key_and_marks_setup_complete(self):
        with patch.object(configure_gemini.getpass, "getpass", return_value=""):
            configure_gemini.configure_gemini()

        self.assertFalse(self.secrets_file.exists())
        self.assertTrue(self.prompt_marker.exists())

    def test_existing_key_is_kept_without_prompting(self):
        self.config_directory.mkdir(parents=True)
        self.secrets_file.write_text(json.dumps({"gemini_api_key": "existing-key"}), encoding="utf-8")
        with patch.object(configure_gemini.getpass, "getpass") as prompt:
            configure_gemini.configure_gemini()

        prompt.assert_not_called()
        self.assertEqual(json.loads(self.secrets_file.read_text(encoding="utf-8")), {"gemini_api_key": "existing-key"})
        self.assertTrue(self.prompt_marker.exists())


if __name__ == "__main__":
    unittest.main()
