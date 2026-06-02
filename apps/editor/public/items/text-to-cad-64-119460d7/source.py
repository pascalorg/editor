# Generated parametric CAD source sketch for Pascal text-to-CAD.
# This mirrors the generated GLB dimensions; phase 2 can execute it with CadQuery/build123d.
prompt = "生成一个齿轮，64齿，中间挖空"
cad_intent = {
  "family": "gear",
  "color": "#C0C0C0",
  "dimensions": {
    "length": 0.3,
    "width": 0.2,
    "baseThickness": 0.03,
    "wallHeight": 0.1,
    "wallThickness": 0.03
  },
  "mountingHoles": {
    "count": 0,
    "diameter": 0.02,
    "marginX": 0.05,
    "marginZ": 0.05
  }
}

# Model: L-shaped motor bracket with base plate, upright wall, side rails, triangular ribs,
# and visible mounting holes from the prompt-derived mountingHoles pattern.