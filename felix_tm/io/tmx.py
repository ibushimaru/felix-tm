"""TMX 1.4 import/export.

Ported from Felix CAT TMXReader/TMXWriter.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

from ..memory.record import Record

# TMX date format: YYYYMMDDTHHmmssZ
_TMX_DATE_FMT = "%Y%m%dT%H%M%SZ"


def _parse_tmx_date(s: str | None) -> datetime:
    if not s:
        return datetime.now()
    try:
        return datetime.strptime(s, _TMX_DATE_FMT)
    except ValueError:
        return datetime.now()


def _format_tmx_date(dt: datetime) -> str:
    return dt.strftime(_TMX_DATE_FMT)


def _seg_text(elem: ET.Element | None) -> str:
    """Extract text content from a <seg> element, including tail text of children."""
    if elem is None:
        return ""
    parts = []
    if elem.text:
        parts.append(elem.text)
    for child in elem:
        # Preserve inline tags like <it>, <bpt>, <ept>, <ph>, <hi>
        if child.text:
            parts.append(child.text)
        if child.tail:
            parts.append(child.tail)
    return "".join(parts)


def import_tmx(
    path: str | Path,
    source_lang: str | None = None,
    target_lang: str | None = None,
) -> list[Record]:
    """Import records from a TMX file.

    Args:
        path: Path to TMX file.
        source_lang: Source language code (e.g. 'en', 'ja'). Auto-detected from header if None.
        target_lang: Target language code. Auto-detected if None.

    Returns:
        List of Record objects.
    """
    tree = ET.parse(path)
    root = tree.getroot()

    # Read header
    header = root.find("header")
    if header is not None and source_lang is None:
        source_lang = header.get("srclang", "").lower()

    body = root.find("body")
    if body is None:
        return []

    records: list[Record] = []

    for tu in body.iter("tu"):
        tuvs: dict[str, str] = {}
        for tuv in tu.iter("tuv"):
            lang = tuv.get("{http://www.w3.org/XML/1998/namespace}lang", "")
            if not lang:
                lang = tuv.get("lang", "")
            seg = tuv.find("seg")
            tuvs[lang.lower()] = _seg_text(seg)

        if len(tuvs) < 2:
            continue

        # Determine source and target
        src_text = ""
        tgt_text = ""

        if source_lang:
            src_key = _find_lang_key(tuvs, source_lang)
            if src_key:
                src_text = tuvs[src_key]

        if target_lang:
            tgt_key = _find_lang_key(tuvs, target_lang)
            if tgt_key:
                tgt_text = tuvs[tgt_key]

        # Auto-detect: first two languages
        if not src_text or not tgt_text:
            langs = list(tuvs.keys())
            if not src_text:
                src_text = tuvs[langs[0]]
            if not tgt_text:
                for lang in langs:
                    if tuvs[lang] != src_text:
                        tgt_text = tuvs[lang]
                        break

        if src_text and tgt_text:
            rec = Record(
                source=src_text,
                target=tgt_text,
                created=_parse_tmx_date(tu.get("creationdate")),
                modified=_parse_tmx_date(tu.get("changedate")),
                created_by=tu.get("creationid", ""),
                modified_by=tu.get("changeid", ""),
            )
            # Usage count
            usage = tu.get("usagecount")
            if usage and usage.isdigit():
                rec.refcount = int(usage)

            records.append(rec)

    return records


def _find_lang_key(tuvs: dict[str, str], lang: str) -> str | None:
    """Find a matching language key, handling variants like 'en' vs 'en-us'."""
    lang = lang.lower()
    if lang in tuvs:
        return lang
    # Try prefix match
    for key in tuvs:
        if key.startswith(lang) or lang.startswith(key):
            return key
    return None


def export_tmx(
    records: list[Record],
    path: str | Path,
    source_lang: str = "en",
    target_lang: str = "ja",
) -> None:
    """Export records to a TMX 1.4 file.

    Args:
        records: List of Record objects.
        path: Output file path.
        source_lang: Source language code.
        target_lang: Target language code.
    """
    tmx = ET.Element("tmx", version="1.4")

    header = ET.SubElement(tmx, "header", {
        "creationtool": "felix-tm",
        "creationtoolversion": "0.1.0",
        "datatype": "plaintext",
        "segtype": "sentence",
        "adminlang": source_lang.upper(),
        "srclang": source_lang.upper(),
        "o-tmf": "felix-tm",
    })

    body = ET.SubElement(tmx, "body")

    for rec in records:
        tu_attrs = {}
        if rec.created:
            tu_attrs["creationdate"] = _format_tmx_date(rec.created)
        if rec.modified:
            tu_attrs["changedate"] = _format_tmx_date(rec.modified)
        if rec.created_by:
            tu_attrs["creationid"] = rec.created_by
        if rec.modified_by:
            tu_attrs["changeid"] = rec.modified_by
        if rec.refcount:
            tu_attrs["usagecount"] = str(rec.refcount)

        tu = ET.SubElement(body, "tu", tu_attrs)

        tuv_src = ET.SubElement(tu, "tuv")
        tuv_src.set("xml:lang", source_lang)
        seg_src = ET.SubElement(tuv_src, "seg")
        seg_src.text = rec.source

        tuv_tgt = ET.SubElement(tu, "tuv")
        tuv_tgt.set("xml:lang", target_lang)
        seg_tgt = ET.SubElement(tuv_tgt, "seg")
        seg_tgt.text = rec.target

    # Write with XML declaration
    tree = ET.ElementTree(tmx)
    ET.indent(tree, space="  ")
    tree.write(str(path), encoding="utf-8", xml_declaration=True)
