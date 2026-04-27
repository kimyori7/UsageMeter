from __future__ import annotations

import sys

try:
    import winreg  # type: ignore
except ImportError:  # non-Windows or stubbed env
    winreg = None  # type: ignore

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VALUE_NAME = "ClaudeMeter"


def _open_run_key(write: bool):
    if winreg is None:
        raise RuntimeError("winreg not available on this platform")
    flags = winreg.KEY_WRITE if write else winreg.KEY_READ
    return winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, flags)


def enable(exe_path: str) -> None:
    command = f'"{exe_path}" --start-minimized'
    with _open_run_key(write=True) as handle:
        winreg.SetValueEx(handle, VALUE_NAME, 0, winreg.REG_SZ, command)


def disable() -> None:
    try:
        with _open_run_key(write=True) as handle:
            try:
                winreg.DeleteValue(handle, VALUE_NAME)
            except FileNotFoundError:
                pass
    except FileNotFoundError:
        pass


def is_enabled() -> bool:
    if winreg is None:
        return False
    try:
        with _open_run_key(write=False) as handle:
            try:
                winreg.QueryValueEx(handle, VALUE_NAME)
                return True
            except FileNotFoundError:
                return False
    except FileNotFoundError:
        return False
