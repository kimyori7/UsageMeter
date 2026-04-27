from unittest.mock import MagicMock, patch

from claudemeter import autostart


def test_enable_writes_registry_value():
    fake_winreg = MagicMock()
    handle = MagicMock()
    fake_winreg.OpenKey.return_value.__enter__.return_value = handle

    with patch.object(autostart, "winreg", fake_winreg):
        autostart.enable("C:\\app\\ClaudeMeter.exe")

    fake_winreg.SetValueEx.assert_called_once()
    args = fake_winreg.SetValueEx.call_args[0]
    assert args[1] == "ClaudeMeter"
    assert "ClaudeMeter.exe" in args[4]
    assert "--start-minimized" in args[4]


def test_disable_deletes_registry_value():
    fake_winreg = MagicMock()
    handle = MagicMock()
    fake_winreg.OpenKey.return_value.__enter__.return_value = handle

    with patch.object(autostart, "winreg", fake_winreg):
        autostart.disable()

    fake_winreg.DeleteValue.assert_called_once_with(handle, "ClaudeMeter")


def test_disable_silent_when_value_absent():
    fake_winreg = MagicMock()
    handle = MagicMock()
    fake_winreg.OpenKey.return_value.__enter__.return_value = handle
    fake_winreg.DeleteValue.side_effect = FileNotFoundError

    with patch.object(autostart, "winreg", fake_winreg):
        autostart.disable()  # must not raise


def test_is_enabled_returns_true_when_value_present():
    fake_winreg = MagicMock()
    handle = MagicMock()
    fake_winreg.OpenKey.return_value.__enter__.return_value = handle
    fake_winreg.QueryValueEx.return_value = ("C:\\path\\ClaudeMeter.exe", 1)

    with patch.object(autostart, "winreg", fake_winreg):
        assert autostart.is_enabled() is True


def test_is_enabled_returns_false_when_value_absent():
    fake_winreg = MagicMock()
    handle = MagicMock()
    fake_winreg.OpenKey.return_value.__enter__.return_value = handle
    fake_winreg.QueryValueEx.side_effect = FileNotFoundError

    with patch.object(autostart, "winreg", fake_winreg):
        assert autostart.is_enabled() is False
