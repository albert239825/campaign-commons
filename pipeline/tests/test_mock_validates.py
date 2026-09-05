import subprocess
import sys
from pathlib import Path

from gotham.config import ROOT
from gotham.validate import validate_dir


def test_mock_generator_output_validates(tmp_path: Path) -> None:
    """Contracts and mock generator must agree; this is the drift alarm for both sides.

    Writes to tmp_path so running the suite never clobbers real artifacts in data/out.
    """
    subprocess.run(
        [sys.executable, str(ROOT / "pipeline" / "scripts" / "make_mock_data.py"), "--out", str(tmp_path)],
        check=True,
        capture_output=True,
    )
    assert validate_dir(tmp_path) == 0
