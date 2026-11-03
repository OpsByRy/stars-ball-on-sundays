"""Copy public source for tests, excluding only root build outputs and Git metadata."""
from pathlib import Path
import shutil

ROOT_OUTPUTS = {'.git', 'dist', 'dist-cloudflare', 'dist-github'}

def copy_public_source(source, destination):
    source, destination = Path(source), Path(destination)
    if source.is_symlink() or not source.is_dir():
        raise ValueError('Regular source directory required')
    def ignore(folder, names):
        ignored = {'__pycache__'} & set(names)
        if Path(folder) == source:
            ignored |= ROOT_OUTPUTS & set(names)
        for name in set(names) - ignored:
            if (Path(folder) / name).is_symlink():
                raise ValueError('Test source links must not copy outside the source boundary')
        return ignored
    return shutil.copytree(source, destination, ignore=ignore)
