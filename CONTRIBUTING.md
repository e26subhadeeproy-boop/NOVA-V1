# Contributing to NOVA

Thanks for helping improve NOVA. Keep changes focused and preserve local-first behavior unless a feature explicitly requires an online provider.

## Before opening a pull request

1. Open an issue for larger changes so the approach can be discussed.
2. Keep secrets, local databases, model weights, and generated packages out of commits. Check the staged files with `git status --short` and `git diff --cached --stat`.
3. Run the checks from the [README](README.md#development-and-checks).
4. Describe the user-visible change, how it was checked, and any setup or privacy implications.

## Code changes

- Keep Python changes compatible with the versions listed in the README.
- Keep the Android companion lightweight; model inference runs on the laptop.
- Update documentation when startup, settings, data handling, or build steps change.
- Add or update unit tests when behavior changes.

## Reporting problems

Do not put API keys, personal chat data, or exploitable security details in public issues. Follow [SECURITY.md](SECURITY.md) for vulnerability reports.
