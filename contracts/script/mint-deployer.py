#!/usr/bin/env python3
"""Mine a vanity deployer address straight into an encrypted keystore.

The private key is never printed, never written to a file, and never appears in any process's
argument list. Only the address is shown.

    contracts/script/mint-deployer.py --prefix 000888 --account noesis-deployer

── Why this exists rather than two cast commands ─────────────────────────────────────────────────
`cast wallet vanity` prints the private key to stdout. `--save-path` writes it as plaintext JSON.
`cast wallet import --interactive` reads from /dev/tty, so the key cannot be piped from one to the
other. Every composition of those two leaves the key rendered on a terminal, written to disk in the
clear, or passed in argv where /proc exposes it to every process of the same user.

A deployer address is chosen, not random, so `cast wallet new` — which does generate straight into
an encrypted keystore — cannot be used either.

So this drives both halves itself. `cast wallet vanity` mines, its stdout is captured rather than
displayed, and the key is handed to `cast wallet import` over a pseudo-terminal, which is what that
command wants and is a kernel object rather than a file. The password is read with a hidden prompt
and goes the same way.

── What it does NOT do ───────────────────────────────────────────────────────────────────────────
It implements no cryptography. Key generation, address derivation and keystore encryption are all
Foundry's, unchanged — which is the point: a mainnet genesis key is not the place for hand-rolled
secp256k1, and a wrapper that only moves bytes between two audited programs has nothing to get
subtly wrong.

── The residue, stated plainly ───────────────────────────────────────────────────────────────────
The key exists in the memory of `cast wallet vanity`, of this process, and of `cast wallet import`,
for as long as each runs. That is unavoidable for any tool that mines a key and then encrypts it.
What is avoided is every form that OUTLIVES the process or is visible from outside it: no terminal
scrollback, no shell history, no file, no argv. Python strings are immutable, so the buffers here
cannot be reliably zeroed; they are dropped as soon as they are used and the process is short-lived.

Entropy is `cast wallet vanity`'s: a fresh random wallet per candidate, not a walk from one seed.
That distinction is the whole of the Profanity failure — 1inch's miner seeded from 32 bits, which
collapsed the keyspace and drained the addresses it had produced.
"""

from __future__ import annotations

import argparse
import contextlib
import getpass
import io
import os
import pty
import re
import secrets
import select
import shutil
import subprocess
import sys
import tempfile

ADDRESS = re.compile(r"Address:\s*(0x[0-9a-fA-F]{40})")
PRIVATE_KEY = re.compile(r"Private Key:\s*(0x[0-9a-fA-F]{64})")
SAVED = re.compile(r"Address:\s*(0x[0-9a-fA-F]{40})")


def die(message: str) -> "NoReturn":  # type: ignore[valid-type]
    print(f"mint-deployer: {message}", file=sys.stderr)
    raise SystemExit(1)


def mine(prefix: str, threads: int | None) -> tuple[str, str]:
    """Return (address, private_key). Stdout is captured, so neither is ever displayed."""
    argv = ["cast", "wallet", "vanity", "--starts-with", prefix]
    if threads is not None:
        argv += ["--jobs", str(threads)]
    print(f"mining an address starting 0x{prefix} — this is the slow part, leave it alone", file=sys.stderr)
    try:
        done = subprocess.run(argv, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        die("`cast` is not on PATH — this needs Foundry")
    if done.returncode != 0:
        # stderr may legitimately carry a usage error; it never carries the key.
        die(f"cast wallet vanity exited {done.returncode}: {done.stderr.strip()[:400]}")
    address = ADDRESS.search(done.stdout)
    key = PRIVATE_KEY.search(done.stdout)
    if address is None or key is None:
        die("could not read an address and a key out of cast wallet vanity's output")
    return address.group(1), key.group(1)


def store(account: str, keystore_dir: str | None, key: str, password: str) -> str:
    """Hand the key to `cast wallet import` over a pty. Returns the address it reports saving."""
    argv = ["cast", "wallet", "import", account, "--interactive"]
    if keystore_dir is not None:
        argv += ["--keystore-dir", keystore_dir]

    pid, fd = pty.fork()
    if pid == 0:  # child: becomes cast, with the pty as its controlling terminal
        os.execvp(argv[0], argv)

    transcript = ""
    sent_key = False
    sent_password = False
    try:
        while True:
            ready, _, _ = select.select([fd], [], [], 30)
            if not ready:
                break
            try:
                chunk = os.read(fd, 4096)
            except OSError:  # the child closed the pty
                break
            if not chunk:
                break
            transcript += chunk.decode("utf8", "replace")
            if not sent_key and "private key" in transcript.lower():
                os.write(fd, (key + "\r").encode())
                sent_key = True
            elif sent_key and not sent_password and "password" in transcript.lower():
                os.write(fd, (password + "\r").encode())
                sent_password = True
    finally:
        os.close(fd)
        _, status = os.waitpid(pid, 0)

    code = os.waitstatus_to_exitcode(status)
    if code != 0:
        die(f"cast wallet import exited {code}; the keystore was not written")
    saved = SAVED.search(transcript)
    if saved is None:
        die("cast wallet import did not report an address; assume the keystore was NOT written")
    return saved.group(1)


def verify(account: str, keystore_dir: str | None, expected: str, password: str) -> None:
    """Read the address back out of the keystore, so a silent mismatch cannot pass as success."""
    # `--keystore` takes a folder or a single file; `--account` only ever means the default folder.
    keystore = os.path.join(keystore_dir, account) if keystore_dir is not None else None
    argv = ["cast", "wallet", "address"]
    argv += ["--keystore", keystore] if keystore else ["--account", account]

    # The password reaches cast through `--password-file`, on a 0600 file in tmpfs that is unlinked
    # immediately. Not `--password`, which is argv and therefore in /proc and in `ps` for every
    # process this user runs; and not ETH_PASSWORD, which is bound to --password-file and so is read
    # as a PATH rather than as the secret. /dev/stdin is refused by cast, so a pipe is not available.
    scratch = tempfile.mkdtemp(dir="/dev/shm" if os.path.isdir("/dev/shm") else None)
    path = os.path.join(scratch, "p")
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(password)
        done = subprocess.run(
            argv + ["--password-file", path], capture_output=True, text=True, check=False
        )
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    got = done.stdout.strip()
    if done.returncode != 0 or got.lower() != expected.lower():
        die(
            "the keystore does not read back as the address that was mined "
            f"(wanted {expected}, got {got or 'nothing'}) — do NOT use it"
        )


def selftest() -> None:
    """Run the whole flow on a throwaway prefix and assert the claim this tool exists to make.

    The claim is negative — that a 64-hex private key appears in NO output — and a negative claim
    about output is exactly the kind that rots silently, because nothing fails when it stops being
    true. So it is executed rather than documented: the run below is the real `mine` and `store`,
    and the assertion reads their combined output looking for anything shaped like a key.
    """
    scratch = tempfile.mkdtemp(prefix="mint-selftest-")
    captured = io.StringIO()
    try:
        password = secrets.token_urlsafe(24)
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            address, key = mine("0", None)  # one nibble: immediate
            saved = store("selftest", scratch, key, password)
            verify("selftest", scratch, address, password)
        text = captured.getvalue()

        if saved.lower() != address.lower():
            die(f"selftest: import saved {saved} but {address} was mined")
        leaked = re.findall(r"0x[0-9a-fA-F]{64}", text)
        if leaked:
            die(f"selftest: A PRIVATE KEY REACHED THE OUTPUT ({len(leaked)} occurrence(s))")
        if key.lower() in text.lower():
            die("selftest: the mined key reached the output")
        if not os.path.exists(os.path.join(scratch, "selftest")):
            die("selftest: no keystore file was written")
        with open(os.path.join(scratch, "selftest"), encoding="utf8") as handle:
            blob = handle.read()
        if key[2:].lower() in blob.lower():
            die("selftest: THE KEYSTORE CONTAINS THE KEY IN CLEAR")
        if '"cipher"' not in blob:
            die("selftest: the keystore is not an encrypted V3 file")

        print(f"selftest OK — mined {address}, keystore encrypted, no key in output")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Mine a vanity address into an encrypted keystore without ever printing the key."
    )
    if "--selftest" in sys.argv[1:]:
        selftest()
        return
    ap.add_argument("--prefix", required=True, help="leading hex digits of the address, e.g. 000888")
    ap.add_argument("--account", required=True, help="keystore account name, e.g. noesis-deployer")
    ap.add_argument("--keystore-dir", default=None, help="default: ~/.foundry/keystores")
    ap.add_argument("--jobs", type=int, default=None, help="mining threads (default: all cores)")
    args = ap.parse_args()

    prefix = args.prefix[2:] if args.prefix[:2].lower() == "0x" else args.prefix
    if not re.fullmatch(r"[0-9a-fA-F]{1,38}", prefix):
        die("--prefix must be 1..38 hex digits")

    if not sys.stdin.isatty():
        die("refusing to run without a terminal: the password must be typed, never piped")

    password = getpass.getpass("Keystore password (this encrypts the key): ")
    if password != getpass.getpass("Again: "):
        die("passwords did not match")
    if len(password) < 12:
        die("use a longer passphrase — this is the only thing protecting the key at rest")

    address, key = mine(prefix, args.jobs)
    saved = store(args.account, args.keystore_dir, key, password)
    del key  # dropped as early as the language allows; see the note at the top

    if saved.lower() != address.lower():
        die(f"cast saved {saved} but {address} was mined — do NOT use this keystore")
    verify(args.account, args.keystore_dir, address, password)

    print(address)
    print(
        f"\nkeystore account `{args.account}` written and read back at the address above.\n"
        f"The private key was never printed, written to a file, or placed in any argument list.\n"
        f"Sign with:  forge script <script> --account {args.account} --sender {address} --broadcast",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
