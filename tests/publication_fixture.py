"""One source-only test fixture, restored between mutation cases."""
from contextlib import contextmanager
from pathlib import Path
import hashlib
import os
import shutil
import stat
import tempfile
import threading
import uuid

ROOT_OUTPUTS = {'.git', '.release', '.local-data', 'dist', 'dist-cloudflare',
                'dist-github', 'hosting-build-receipt.json', '.env'}


def _tree(root):
    result = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            p = Path(directory) / name
            rel = p.relative_to(root)
            mode = stat.S_IMODE(p.lstat().st_mode)
            if p.is_symlink():
                result[rel] = ('link', os.readlink(p), mode)
            elif p.is_dir():
                result[rel] = ('directory', mode)
            else:
                digest = hashlib.sha256()
                with p.open('rb') as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(block)
                result[rel] = ('file', digest.hexdigest(), mode)
    return result


class PublicationFixture:
    def __init__(self, source, mutable):
        self.source = Path(source).resolve()
        self.mutable = tuple(Path(p) for p in mutable)
        if any(p.is_absolute() or '..' in p.parts or not p.parts for p in self.mutable):
            raise ValueError('Fixture mutations require explicit relative files')
        self._temp = None
        self._lock = threading.Lock()
        self._invalid = False
        self.copies = 0

    def _ensure(self):
        if self._invalid:
            raise RuntimeError('Fixture integrity failed; reuse is refused')
        if self._temp is not None:
            return
        for rel in self.mutable:
            p = self.source / rel
            if not p.is_file() or any(x.is_symlink() for x in [p, *p.parents] if x == self.source or self.source in x.parents):
                raise ValueError('Mutable fixture source must be an unlinked regular file')
        self._temp = tempfile.TemporaryDirectory(prefix='sbos-publication-fixture-')
        self.root = Path(self._temp.name) / 'site'
        def ignore(directory, names):
            return [name for name in names if name in {'__pycache__', '.pytest_cache', '.DS_Store'}
                    or (Path(directory) == self.source and
                        (name in ROOT_OUTPUTS or name.startswith('.env.')))]
        shutil.copytree(self.source, self.root, ignore=ignore, symlinks=True)
        self.copies += 1
        self._baseline = _tree(self.root)
        self._saved = {rel: (self.root / rel).read_bytes() for rel in self.mutable}

    def _restore(self):
        # Never write through a directory link introduced by a mutation case.
        for rel, token in self._baseline.items():
            if token[0] == 'directory':
                p = self.root / rel
                if p.is_symlink() or not p.is_dir():
                    raise AssertionError('Fixture input directory changed: ' + str(rel))
        for rel, raw in self._saved.items():
            p = self.root / rel
            temporary = p.with_name(p.name + '.restore-' + uuid.uuid4().hex)
            with temporary.open('xb') as stream:
                stream.write(raw)
            temporary.chmod(self._baseline[rel][-1])
            os.replace(temporary, p)
        # This tree is owned by TemporaryDirectory; no original input is removed.
        added = set(_tree(self.root)) - set(self._baseline)
        for rel in sorted(added, key=lambda p: len(p.parts), reverse=True):
            p = self.root / rel
            if p.is_symlink() or not p.is_dir():
                p.unlink()
            else:
                p.rmdir()
        if _tree(self.root) != self._baseline:
            raise AssertionError('An undeclared fixture input changed')

    @contextmanager
    def session(self):
        if not self._lock.acquire(blocking=False):
            raise RuntimeError('Concurrent or nested fixture use is refused')
        try:
            self._ensure()
            try:
                yield self.root
            finally:
                try:
                    self._restore()
                except BaseException:
                    self._invalid = True
                    raise
        finally:
            self._lock.release()

    def close(self):
        if not self._lock.acquire(blocking=False):
            raise RuntimeError('Cannot close an active fixture')
        try:
            if self._temp is not None:
                self._temp.cleanup()
                self._temp = None
        finally:
            self._lock.release()
