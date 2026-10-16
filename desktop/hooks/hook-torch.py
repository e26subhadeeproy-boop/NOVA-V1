"""Package Torch's native runtime without collecting unrelated optional modules."""

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs


datas = collect_data_files(
    "torch",
    excludes=["**/*.h", "**/*.hpp", "**/*.cuh", "**/*.lib", "**/*.cpp", "**/*.pyi", "**/*.cmake"],
)
binaries = collect_dynamic_libs("torch")
