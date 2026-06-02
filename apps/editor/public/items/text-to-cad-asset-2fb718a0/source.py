# Generated parametric CAD source sketch for Pascal text-to-CAD.
# This mirrors the generated GLB dimensions; phase 2 can execute it with CadQuery/build123d.
prompt = "生成一个带四个安装孔的电机支架"
cad_intent = {
  "family": "motor_bracket",
  "color": "gray",
  "dimensions": {
    "length": 0.3,
    "width": 0.2,
    "baseThickness": 0.03,
    "wallHeight": 0.1,
    "wallThickness": 0.03
  },
  "mountingHoles": {
    "count": 4,
    "diameter": 0.02,
    "marginX": 0.05,
    "marginZ": 0.05
  }
}

# Model: L-shaped motor bracket with base plate, upright wall, side rails, triangular ribs,
# and visible mounting holes from the prompt-derived mountingHoles pattern.