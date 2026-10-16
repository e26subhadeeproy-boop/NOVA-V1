import unittest
import threading
from types import SimpleNamespace
from unittest.mock import patch

import torch

from nova_app import DEFAULT_SETTINGS, system_info, validate_settings
from training.assistant import _StopOnEvent


class NovaAppSettingsTests(unittest.TestCase):
    def test_all_response_profiles_are_valid(self):
        for profile in ("fast", "balanced", "deep"):
            with self.subTest(profile=profile):
                settings = validate_settings({
                    **DEFAULT_SETTINGS,
                    "speed_profile": profile,
                })
                self.assertEqual(settings["speed_profile"], profile)

    def test_unknown_or_non_string_profile_is_rejected(self):
        for profile in ("fastest", [], {}):
            with self.subTest(profile=profile):
                with self.assertRaises(ValueError):
                    validate_settings({
                        **DEFAULT_SETTINGS,
                        "speed_profile": profile,
                    })

    def test_system_telemetry_reports_local_resource_fields(self):
        telemetry = system_info()
        self.assertIn("cpu_percent", telemetry)
        self.assertIn("ram_percent", telemetry)
        self.assertIn("process_ram_gb", telemetry)
        self.assertIn("gpu", telemetry)
        self.assertIsInstance(telemetry["warnings"], list)

    def test_system_telemetry_warns_at_high_resource_usage(self):
        virtual_memory = SimpleNamespace(
            percent=90.0,
            used=9 * (1024 ** 3),
            total=10 * (1024 ** 3),
        )
        with (
            patch("nova_app.psutil.virtual_memory", return_value=virtual_memory),
            patch("nova_app.psutil.cpu_percent", return_value=92.0),
            patch("nova_app.psutil.Process", return_value=SimpleNamespace(
                memory_info=lambda: SimpleNamespace(rss=512 * (1024 ** 2)),
            )),
        ):
            telemetry = system_info()
        self.assertEqual(len(telemetry["warnings"]), 2)
        self.assertIn("System memory usage is high.", telemetry["warnings"])
        self.assertIn("CPU usage is very high.", telemetry["warnings"])

    def test_stop_criterion_counts_generated_tokens_not_prompt_tokens(self):
        criterion = _StopOnEvent(threading.Event())
        criterion.prompt_length = 12
        criterion(torch.zeros((1, 15), dtype=torch.long), None)
        self.assertEqual(criterion.generated_tokens, 3)


if __name__ == "__main__":
    unittest.main()
