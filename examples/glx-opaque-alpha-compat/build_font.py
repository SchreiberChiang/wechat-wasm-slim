"""Build the bundled UI-only CJK font; never modify the source font.

Requires fontTools 4.60.0. Generated font binaries remain local and are ignored.
Run before import, or after changing UI text, with a fresh --output directory.
"""

import argparse
import hashlib
import json
from pathlib import Path

import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont

SOURCE_SHA256 = "a2b93e6c2db05d6bbbf6f27d413ec73269735b7b679019c8a5aa9670ff0ffbf2"
LICENSE_SHA256 = "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2"
LICENSE_URL = "https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/LICENSE"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if fontTools.version != "4.60.0":
        raise SystemExit("Use the audited fontTools 4.60.0 for reproducible subsetting")
    if digest(args.source) != SOURCE_SHA256:
        raise SystemExit("Source font bytes differ from the audited Noto Sans SC 2.002")
    root = Path(__file__).resolve().parent
    license_path = root / "fonts/OFL.txt"
    if digest(license_path) != LICENSE_SHA256:
        raise SystemExit("Unexpected font license")
    output_font = args.output / "AcceptanceCJK.otf"
    manifest = args.output / "FONT.json"
    if output_font.exists() or manifest.exists():
        raise SystemExit("Refusing to overwrite a font or provenance record")
    # The v2 UI reads user-visible actions and verdicts from this exact catalog.
    sources = sorted([*root.glob("*.gd"), root / "cases.json"])
    if not (root / "main.gd").is_file():
        raise SystemExit("UI sources must exist before collecting glyphs")
    text = "".join(path.read_text(encoding="utf-8") for path in sources)
    codepoints = set(range(32, 127)) | {ord(char) for char in text if ord(char) >= 160}
    font = TTFont(args.source, recalcTimestamp=False)
    missing = sorted(codepoints - set(font.getBestCmap()))
    if missing:
        raise SystemExit("Source font is missing UI codepoints: " + str(missing))
    options = subset.Options()
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 8, 9, 11, 13, 14, 16, 17]
    options.name_languages = [0x409]
    options.name_legacy = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=sorted(codepoints))
    subsetter.subset(font)
    # Modified font has its own family/PostScript names; preserve authors/license.
    names = {1: "Acceptance CJK", 2: "Regular", 3: "AcceptanceCJK-UI-1",
             4: "Acceptance CJK Regular", 6: "AcceptanceCJK-Regular",
             16: "Acceptance CJK", 17: "Regular"}
    for record in font["name"].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    if "CFF " in font:
        cff = font["CFF "].cff
        cff.fontNames = ["AcceptanceCJK-Regular"]
        cff.topDictIndex[0].FamilyName = "Acceptance CJK"
        cff.topDictIndex[0].FullName = "Acceptance CJK Regular"
    args.output.mkdir(parents=True, exist_ok=True)
    font.save(output_font, reorderTables=True)
    saved = TTFont(output_font)
    if codepoints - set(saved.getBestCmap()):
        raise SystemExit("Font coverage changed during subsetting")
    record = {
        "schema": "acceptance-ui-font-v1",
        "source": "Locally installed Noto Sans SC Regular 2.002 (original font preserved)",
        "sourceSha256": SOURCE_SHA256,
        "sourceBytes": args.source.stat().st_size,
        "fontToolsVersion": fontTools.version,
        "licenseUrl": LICENSE_URL,
        "licenseSha256": LICENSE_SHA256,
        "copyright": "Copyright 2014-2020 Adobe (http://www.adobe.com/).",
        "modifications": ["UI characters and ASCII subset", "Renamed Acceptance CJK"],
        "sources": [{"path": p.name, "sha256": digest(p)} for p in sources],
        "codepoints": sorted(codepoints),
        "output": {"path": output_font.name, "sha256": digest(output_font),
                   "bytes": output_font.stat().st_size},
    }
    manifest.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"fontBytes": record["output"]["bytes"], "glyphCodepoints": len(codepoints),
                      "fontSha256": record["output"]["sha256"]}))


if __name__ == "__main__":
    main()
