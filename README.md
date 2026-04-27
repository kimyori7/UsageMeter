# ClaudeMeter

Windows tray app that shows your Claude Code token usage in a 3-level tree (period → session → model).

## Install (dev)

    python -m venv .venv
    .venv\Scripts\activate
    pip install -r requirements-dev.txt
    pytest
    python -m claudemeter
