"""Explicitly authorized one-shot launcher. Never invoke during computer-only preparation."""
import argparse
import json
from pathlib import Path
import subprocess


def run_owned(command, timeout=20):
    try:
        child = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return {"status": "helper-finished", "exitCode": child.returncode,
                "stdout": child.stdout, "stderr": child.stderr}
    except subprocess.TimeoutExpired:
        # subprocess.run kills and waits only the child it created. No process search/kill.
        return {"status": "owned-helper-hard-timeout", "exitCode": None, "retry": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approved-metadata-only", action="store_true")
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--udid-file", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    if not args.approved_metadata_only:
        parser.error("Explicit human authorization required; no helper launched")
    if not all(path.is_absolute() for path in (args.python, args.udid_file, args.out_dir)) or args.out_dir.exists():
        parser.error("Absolute paths and a new output directory required")
    if not args.python.is_file():
        parser.error("Previously verified interpreter required; no install or replacement")
    args.out_dir.mkdir()
    result = run_owned([str(args.python), "-B", str(Path(__file__).with_name("device_enumerator.py")),
                        "--approved-metadata-only", "--udid-file", str(args.udid_file),
                        "--out", str(args.out_dir / "response.private.json")])
    with (args.out_dir / "helper.private.json").open("x", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
    print(json.dumps({"status": result["status"], "exitCode": result["exitCode"], "retry": False}))


if __name__ == "__main__":
    main()
