---
name: offline-office-documents
description: Read, inspect, create, and edit local DOCX, XLSX, PPTX, and PDF files with the bundled dsh-office command. Use for Word, Excel, PowerPoint, office document, spreadsheet, slide deck, .docx, .xlsx, .pptx, or .pdf work.
---

# Work with offline office files

Use the bundled `dsh-office` command. It runs locally and does not require Python, a plugin, a skill download, or Internet access from the user.

## Safety workflow

1. To read the content of a document, run `dsh-office dump INPUT`. It outputs text and tables in clean, structured Markdown.
2. Run `dsh-office inspect INPUT` before editing to examine document structure, sheet names, and indexes.
3. Preserve the source file. Every edit must use a different output path (in-place modification is disabled for safety).
4. Prefer an `apply` plan for precise changes and `replace` only for intentional global text replacement.
5. Inspect the output after editing.
6. When visual layout matters, run `dsh-office render OUTPUT RENDER_DIR`. Report visual verification only when the command succeeds and the rendered PDF was inspected. Rendering requires a compatible LibreOffice installation on the host.
7. For complex data calculations, transformations, or batch scripts, use `dsh-python script.py`, which is the pre-configured Python environment with `openpyxl`, `python-docx`, `python-pptx`, `pillow`, and `lxml` bundled.

Use only paths inside the current workspace unless the user explicitly selects another permitted location.

## Commands

```bash
# Read / extract content in Markdown format:
dsh-office dump report.docx
dsh-office dump data.xlsx
dsh-office dump slides.pptx
dsh-office dump document.pdf

# Inspect metadata structure:
dsh-office inspect report.docx

# Modify and create:
dsh-office replace source.docx edited.docx --find '旧文字' --replace '新文字'
dsh-office apply source.xlsx edited.xlsx changes.json
dsh-office create new.pptx --title '标题' --text '正文'
dsh-office render edited.pptx rendered

# Run custom python data manipulation:
dsh-python script.py
```

`dump`, `inspect`, `replace`, `apply`, and `create` support `.docx`, `.xlsx`, and `.pptx` (`dump` and `inspect` also support `.pdf`). Commands return JSON on standard output. Use `dsh-office --help` and `dsh-office apply --help` when composing a plan.

## Apply plans

The plan file is JSON with an `operations` array.

DOCX operations: `replace_text`, `set_paragraph`, `add_paragraph`, `set_table_cell`, and `format_paragraph`.

XLSX operations: `set_cell`, `replace_text`, `merge_cells`, `unmerge_cells`, `insert_rows`, `delete_rows`, `set_column_width`, and `set_row_height`. A `set_cell` operation can contain `value`, `formula`, and `style`.

PPTX operations: `set_shape_text`, `format_shape_text`, `set_table_cell`, `add_textbox`, `add_image`, and `add_slide`.

Use the indexes and names returned by `inspect`. Do not guess a paragraph, slide, shape, sheet, or cell target.

## Fidelity limits

The tool edits common OOXML content and styles. It does not execute VBA, recalculate spreadsheet formulas, or guarantee pixel-identical rendering of every Office feature. Preserve macros and unsupported embedded objects by avoiding unrelated structural changes, and state any unverified layout limitations.
