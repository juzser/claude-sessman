#!/usr/bin/env python3
"""Lint generated component code for hardcoded values that should be design tokens.

The kit's rule is "zero hardcoded values" — every color/size/radius/duration must come
from a token (CSS var, theme key, asset). Point this at YOUR component source.

Usage:
  python3 scripts/lint_hardcodes.py src/components            # a dir
  python3 scripts/lint_hardcodes.py Button.tsx Card.vue       # files
  python3 scripts/lint_hardcodes.py --ext .tsx,.vue src/
  python3 scripts/lint_hardcodes.py --include-tests src/      # lint test files too

Flags a line with a raw hex color, px length, or ms/s duration UNLESS it:
  - lives in a token-definition file (anything under a `tokens/` directory, or
    named `tokens.*` / `*.tokens.*`) — that is where the raw values belong,
  - carries an inline allow comment containing 'ds-allow-hardcode'.

Token *references* do not whitelist the line — they are masked out and whatever
survives is still linted. `var(--ds-x, #e5e7eb)` is half token and half hardcode:
the fallback is the value that actually paints when the token is missing, so it
has to be caught. Same for `color:var(--ds-text);border:1px solid #e5e7eb`, where
one real reference used to excuse the rest of the line.

Test files are skipped by default. A test asserting that 5 seconds formats as
'5s', or that a component renders '16px', is stating a fact about the code under
test — it is not drift, and there is no token to replace it with. Pass
--include-tests to lint them anyway. Every skipped count is always printed, so a
skip can never read as a clean scan.
Exit 0 = clean, 1 = violations found, 2 = the invocation was broken (a path that
does not exist, or one that matched no file at all). A gate that read nothing has
not passed anything, so it must not exit 0.
"""
import re
import sys
from pathlib import Path

CODE_EXT = {".css", ".scss", ".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte",
            ".swift", ".kt", ".dart", ".html"}

HEX = re.compile(r"(?<![\w&])#[0-9a-fA-F]{3,8}\b")
PX = re.compile(r"(?<![\w.])\d+(?:\.\d+)?px\b")
MS = re.compile(r"(?<![\w.])\d+(?:\.\d+)?m?s\b")
# raw Tailwind palette utilities (bg-gray-500, text-blue-600, border-red-400 …) that
# bypass semantic tokens — the #1 real-world drift (527 of these in one audited project).
_TW_PREFIX = r"(?:bg|text|border|ring|ring-offset|fill|stroke|from|via|to|divide|outline|decoration|accent|caret|placeholder|shadow)"
_TW_COLOR = r"(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)"
TW = re.compile(rf"(?<![\w-]){_TW_PREFIX}-{_TW_COLOR}-(?:50|100|200|300|400|500|600|700|800|900|950)\b")
# hardcoded font-family not coming from a token/var
FONT = re.compile(r"font-family\s*:\s*(?!.*var\()")
# Token references, masked out of the line before it is linted. `var(` keeps its
# opening paren so the fallback after the comma stays in the residue and is still
# checked; the others carry no lintable payload and go entirely.
VAR_REF = re.compile(r"var\(\s*--[\w-]+")
THEME_REF = re.compile(r"theme\([^)]*\)?")
BRACE_REF = re.compile(r"\{[\w.\-]+\}")
TOKEN_PATH = re.compile(r"tokens?[./][\w./\-]*")
# A custom-property DECLARATION is a token definition. Outside a token file it no
# longer excuses the rest of the line, so `--local:1px;color:#fff` is caught.
CUSTOM_PROP = re.compile(r"--[\w-]+\s*:")
ALLOW = "ds-allow-hardcode"
# px values that are conventionally fine (hairlines, zero, 1px borders) — still reported as info? keep strict but allow 0/1px
PX_OK = {"0px", "1px"}
# test files: Button.test.tsx, time-ago.spec.ts, anything under __tests__/ or tests/
TEST_NAME = re.compile(r"\.(test|spec)\.[^.]+$")
TEST_DIRS = {"__tests__", "tests", "test"}
# token-definition files: tokens/colors.css, tokens.json, theme.tokens.ts …
TOKEN_DIRS = {"tokens", "token"}
# tokens.css, theme.tokens.ts, hds-tokens.css — the separator before "token" may
# be a dot or a hyphen, since an adopter that prefixes its copy (hds-tokens.css)
# is still pointing at its token definitions.
TOKEN_NAME = re.compile(r"(^|[.\-])tokens?\.[^.]+$")


def _relative_parts(path, root=None):
    """Path parts relative to the scanned root, so a project that merely lives
    under a directory named 'test' or 'tokens' is not silently skipped whole."""
    if root is None:
        return path.parts
    try:
        return path.relative_to(root).parts
    except ValueError:
        return path.parts


def is_test_file(path, root=None):
    """True for a test file."""
    if TEST_NAME.search(path.name):
        return True
    return any(part in TEST_DIRS for part in _relative_parts(path, root))


def is_token_file(path, root=None):
    """True for a token-definition file — the one place raw values belong."""
    if TOKEN_NAME.search(path.name):
        return True
    return any(part in TOKEN_DIRS for part in _relative_parts(path, root)[:-1])


def iter_files(paths, exts, include_tests=False):
    """Yields (file, reason) where reason is None to lint, or 'test'/'token' —
    so the caller can report what it did not lint."""
    for p in paths:
        pp = Path(p)
        if pp.is_dir():
            for f in sorted(pp.rglob("*")):
                # node_modules is matched relative to the scanned root for the same
                # reason as TEST_DIRS: an absolute path can contain anything.
                rel = f.relative_to(pp).parts
                if f.suffix in exts and "node_modules" not in rel:
                    if not include_tests and is_test_file(f, pp):
                        yield f, "test"
                    elif is_token_file(f, pp):
                        yield f, "token"
                    else:
                        yield f, None
        elif pp.is_file() and pp.suffix in exts:
            # An explicitly named file is still skipped if it is a test file, so that
            # `lint *.ts` and `lint .` agree. --include-tests overrides both.
            if not include_tests and is_test_file(pp):
                yield pp, "test"
            elif is_token_file(pp):
                yield pp, "token"
            else:
                yield pp, None


def mask_tokens(line):
    """Blank out token references so only non-token values remain lintable."""
    line = VAR_REF.sub("var(", line)
    line = THEME_REF.sub(" ", line)
    line = BRACE_REF.sub(" ", line)
    line = TOKEN_PATH.sub(" ", line)
    line = CUSTOM_PROP.sub(" ", line)
    return line


def lint_line(line, tailwind=True):
    if ALLOW in line:
        return []
    stripped = line.strip()
    if stripped.startswith(("//", "*", "/*", "#", "<!--")):
        return []
    line = mask_tokens(line)
    hits = []
    # @media / @container conditions can't use var() (a CSS limitation) — breakpoint px there
    # is not drift; skip px/ms on those lines (still check hex/tailwind/font).
    media_cond = "@media" in line or "@container" in line
    for m in HEX.finditer(line):
        hits.append(("hex", m.group(0)))
    if not media_cond:
        for m in PX.finditer(line):
            if m.group(0) not in PX_OK:
                hits.append(("px", m.group(0)))
        for m in MS.finditer(line):
            hits.append(("time", m.group(0)))
    if tailwind:
        for m in TW.finditer(line):
            hits.append(("tailwind-palette", m.group(0)))
    if FONT.search(line):
        hits.append(("font-family", "literal font-family"))
    return hits


def main(argv):
    exts = CODE_EXT
    tailwind = True
    include_tests = False
    args = []
    i = 0
    while i < len(argv):
        if argv[i] == "--ext" and i + 1 < len(argv):
            exts = {e if e.startswith(".") else "." + e for e in argv[i + 1].split(",")}
            i += 2
        elif argv[i] in ("--no-tw", "--no-tailwind"):
            tailwind = False
            i += 1
        elif argv[i] == "--include-tests":
            include_tests = True
            i += 1
        else:
            args.append(argv[i])
            i += 1
    if not args:
        print(__doc__)
        return 0

    # A path that does not exist used to fall through iter_files silently and
    # print "OK: no hardcoded values found" — a typo in a CI invocation read as
    # a passing gate. A gate that read nothing has not passed anything.
    missing = [a for a in args if not Path(a).exists()]
    if missing:
        for m in missing:
            print(f"ERROR: no such path: {m}", file=sys.stderr)
        return 2

    found = list(iter_files(args, exts, include_tests))
    if not found:
        print(f"ERROR: matched 0 file(s) in {', '.join(args)} — nothing was "
              f"linted. Check the path and --ext.", file=sys.stderr)
        return 2
    files = [f for f, reason in found if reason is None]
    skipped_tests = sum(1 for _, reason in found if reason == "test")
    skipped_tokens = sum(1 for _, reason in found if reason == "token")
    violations = 0
    for f in files:
        try:
            text = f.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        in_allow = False
        for n, line in enumerate(text.splitlines(), 1):
            if "ds-allow-hardcode:start" in line:
                in_allow = True
                continue
            if "ds-allow-hardcode:end" in line:
                in_allow = False
                continue
            if in_allow:
                continue
            for kind, val in lint_line(line, tailwind):
                print(f"{f}:{n}: hardcoded {kind} '{val}' — use a token")
                violations += 1

    skipped_note = ""
    if skipped_tests:
        skipped_note += (f" Skipped {skipped_tests} test file(s) — "
                         f"pass --include-tests to lint them.")
    if skipped_tokens:
        skipped_note += (f" Skipped {skipped_tokens} token-definition file(s) — "
                         f"raw values belong there.")
    print(f"\nScanned {len(files)} file(s).{skipped_note}")
    if violations:
        print(f"FAIL: {violations} hardcoded value(s). Map each to a token, "
              f"or add a '{ALLOW}' comment for a justified exception.")
        return 1
    print("OK: no hardcoded values found.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
