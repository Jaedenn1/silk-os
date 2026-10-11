from pathlib import Path

path = Path("app/momentum-bridge.module.css")
text = path.read_text()
if ".@media" in text:
    text = text.replace(".@media", "@media")
path.write_text(text)
