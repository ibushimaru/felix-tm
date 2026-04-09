"""XLIFF 1.2 / 2.0 import/export.

XLIFF (XML Localisation Interchange File Format) is the modern standard
used by memoQ, Trados, Memsource, and other CAT tools.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

from ..memory.record import Record

# Namespace URIs
_NS_XLIFF_12 = "urn:oasis:names:tc:xliff:document:1.2"
_NS_XLIFF_20 = "urn:oasis:names:tc:xliff:document:2.0"


def _text_content(elem: ET.Element | None) -> str:
    """Extract all text from an element, including child tails."""
    if elem is None:
        return ""
    parts = []
    if elem.text:
        parts.append(elem.text)
    for child in elem:
        if child.text:
            parts.append(child.text)
        if child.tail:
            parts.append(child.tail)
    return "".join(parts)


def _detect_version(root: ET.Element) -> str:
    """Detect XLIFF version from root element."""
    tag = root.tag
    if _NS_XLIFF_20 in tag:
        return "2.0"
    if _NS_XLIFF_12 in tag:
        return "1.2"
    # Check version attribute
    version = root.get("version", "")
    if version.startswith("2"):
        return "2.0"
    return "1.2"


def import_xliff(path: str | Path) -> list[Record]:
    """Import records from an XLIFF 1.2 or 2.0 file.

    Auto-detects XLIFF version from the namespace.

    Args:
        path: Path to XLIFF file.

    Returns:
        List of Record objects.
    """
    tree = ET.parse(str(path))
    root = tree.getroot()
    version = _detect_version(root)

    if version == "2.0":
        return _import_xliff_20(root)
    return _import_xliff_12(root)


def _import_xliff_12(root: ET.Element) -> list[Record]:
    """Import from XLIFF 1.2 format."""
    ns = {"x": _NS_XLIFF_12}
    records: list[Record] = []

    # Try with namespace first, then without
    trans_units = root.findall(".//x:trans-unit", ns)
    if not trans_units:
        trans_units = root.findall(".//{%s}trans-unit" % _NS_XLIFF_12)
    if not trans_units:
        # No namespace
        trans_units = root.findall(".//trans-unit")

    for tu in trans_units:
        source = tu.find("x:source", ns)
        if source is None:
            source = tu.find("{%s}source" % _NS_XLIFF_12)
        if source is None:
            source = tu.find("source")

        target = tu.find("x:target", ns)
        if target is None:
            target = tu.find("{%s}target" % _NS_XLIFF_12)
        if target is None:
            target = tu.find("target")

        src_text = _text_content(source)
        tgt_text = _text_content(target)

        if not src_text:
            continue

        rec = Record(source=src_text, target=tgt_text or "")
        records.append(rec)

    return records


def _import_xliff_20(root: ET.Element) -> list[Record]:
    """Import from XLIFF 2.0 format."""
    records: list[Record] = []

    # XLIFF 2.0 uses <segment> inside <unit>
    for unit in root.iter("{%s}unit" % _NS_XLIFF_20):
        for segment in unit.iter("{%s}segment" % _NS_XLIFF_20):
            source = segment.find("{%s}source" % _NS_XLIFF_20)
            target = segment.find("{%s}target" % _NS_XLIFF_20)

            src_text = _text_content(source)
            tgt_text = _text_content(target)

            if not src_text:
                continue

            rec = Record(source=src_text, target=tgt_text or "")
            records.append(rec)

    # Fallback: try without namespace
    if not records:
        for unit in root.iter("unit"):
            for segment in unit.iter("segment"):
                source = segment.find("source")
                target = segment.find("target")
                src_text = _text_content(source)
                tgt_text = _text_content(target)
                if src_text:
                    records.append(Record(source=src_text, target=tgt_text or ""))

    return records


def export_xliff(
    records: list[Record],
    path: str | Path,
    source_lang: str = "en",
    target_lang: str = "ja",
    version: str = "1.2",
) -> None:
    """Export records to an XLIFF file.

    Args:
        records: List of Record objects.
        path: Output file path.
        source_lang: Source language code.
        target_lang: Target language code.
        version: XLIFF version ("1.2" or "2.0").
    """
    if version == "2.0":
        _export_xliff_20(records, path, source_lang, target_lang)
    else:
        _export_xliff_12(records, path, source_lang, target_lang)


def _export_xliff_12(
    records: list[Record],
    path: str | Path,
    source_lang: str,
    target_lang: str,
) -> None:
    """Export to XLIFF 1.2 format."""
    ET.register_namespace("", _NS_XLIFF_12)

    xliff = ET.Element("{%s}xliff" % _NS_XLIFF_12, version="1.2")
    file_elem = ET.SubElement(xliff, "{%s}file" % _NS_XLIFF_12, {
        "source-language": source_lang,
        "target-language": target_lang,
        "datatype": "plaintext",
        "original": "felix-tm-export",
    })
    body = ET.SubElement(file_elem, "{%s}body" % _NS_XLIFF_12)

    for i, rec in enumerate(records, 1):
        tu = ET.SubElement(body, "{%s}trans-unit" % _NS_XLIFF_12, id=str(i))

        source = ET.SubElement(tu, "{%s}source" % _NS_XLIFF_12)
        source.text = rec.source

        target = ET.SubElement(tu, "{%s}target" % _NS_XLIFF_12)
        target.text = rec.target

        if rec.context:
            note = ET.SubElement(tu, "{%s}note" % _NS_XLIFF_12)
            note.text = rec.context

    tree = ET.ElementTree(xliff)
    ET.indent(tree, space="  ")
    tree.write(str(path), encoding="utf-8", xml_declaration=True)


def _export_xliff_20(
    records: list[Record],
    path: str | Path,
    source_lang: str,
    target_lang: str,
) -> None:
    """Export to XLIFF 2.0 format."""
    ET.register_namespace("", _NS_XLIFF_20)

    xliff = ET.Element("{%s}xliff" % _NS_XLIFF_20, {
        "version": "2.0",
        "srcLang": source_lang,
        "trgLang": target_lang,
    })

    file_elem = ET.SubElement(xliff, "{%s}file" % _NS_XLIFF_20, id="f1")

    for i, rec in enumerate(records, 1):
        unit = ET.SubElement(file_elem, "{%s}unit" % _NS_XLIFF_20, id=str(i))
        segment = ET.SubElement(unit, "{%s}segment" % _NS_XLIFF_20)

        source = ET.SubElement(segment, "{%s}source" % _NS_XLIFF_20)
        source.text = rec.source

        target = ET.SubElement(segment, "{%s}target" % _NS_XLIFF_20)
        target.text = rec.target

        if rec.context:
            notes = ET.SubElement(unit, "{%s}notes" % _NS_XLIFF_20)
            note = ET.SubElement(notes, "{%s}note" % _NS_XLIFF_20)
            note.text = rec.context

    tree = ET.ElementTree(xliff)
    ET.indent(tree, space="  ")
    tree.write(str(path), encoding="utf-8", xml_declaration=True)
