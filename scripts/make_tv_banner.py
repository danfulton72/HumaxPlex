"""Build Android TV 320x180 banner from the repository's pirate-P icon."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
source = root / "android/app/src/main/res/drawable-nodpi/humaxplex_logo.jpg"
target = root / "android/app/src/main/res/drawable-nodpi/humaxplex_tv_banner.png"
target.parent.mkdir(parents=True, exist_ok=True)
base = Image.new("RGB", (320, 180), "#12151b")
draw = ImageDraw.Draw(base)
draw.rounded_rectangle((4, 4, 315, 175), radius=18, fill="#1b2029", outline="#353e4a", width=2)
logo = Image.open(source).convert("RGBA")
logo.thumbnail((144, 144), Image.Resampling.LANCZOS)
base.paste(logo, (17 + (144-logo.width)//2, 18 + (144-logo.height)//2), logo)
fonts = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
font = next((ImageFont.truetype(f, 26) for f in fonts if Path(f).exists()), ImageFont.load_default())
draw.text((165, 69), "Humax", font=font, fill="#ffffff")
draw.text((165, 98), "Plex", font=font, fill="#e5ad20")
base.save(target)
print("TV launcher banner generated:", target)
