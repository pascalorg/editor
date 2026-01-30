import { AssetInput, ItemNode } from "@pascal-app/core";
export const CATALOG_ITEMS: AssetInput[] = [
   
    
  {
    "id": "pillar",
    "category": "outdoor",
    "name": "Pillar",
    "thumbnail": "/items/pillar/thumbnail.webp",
    "src": "/items/pillar/model.glb",
    "scale": [
      1,
      1,
      1
    ],
    "offset": [
      0,
      0,
      0
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      0.5,
      1.3,
      0.5
    ]
  },


  
  {
    "id": "high-fence",
    "category": "outdoor",
    "name": "High Fence",
    "thumbnail": "/items/high-fence/thumbnail.webp",
    "src": "/items/high-fence/model.glb",
    "scale": [
      1,
      1,
      1
    ],
    "offset": [
      0,
      0.01,
      0
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      4,
      4.1,
      0.5
    ]
  },

  {
    "id": "medium-fence",
    "category": "outdoor",
    "name": "Medium Fence",
    "thumbnail": "/items/medium-fence/thumbnail.webp",
    "src": "/items/medium-fence/model.glb",
    "scale": [
      0.49,
      0.49,
      0.49
    ],
    "offset": [
      0,
      0.01,
      0
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      2,
      2,
      0.5
    ]
  },
  
  {
    "id": "low-fence",
    "category": "outdoor",
    "name": "Low Fence",
    "thumbnail": "/items/low-fence/thumbnail.webp",
    "src": "/items/low-fence/model.glb",
    "scale": [
      1,
      1,
      1
    ],
    "offset": [
      0,
      0.01,
      0
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      2,
      0.8,
      0.5
    ]
  },

  {
    "id": "bush",
    "category": "outdoor",
    "name": "Bush",
    "thumbnail": "/items/bush/thumbnail.webp",
    "src": "/items/bush/model.glb",
    "scale": [
      0.96,
      0.96,
      0.96
    ],
    "offset": [
      -0.14,
      0.01,
      -0.13
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      3,
      1.1,
      1
    ]
  },
  
  {
    "id": "fir-tree",
    "category": "outdoor",
    "name": "Fir",
    "thumbnail": "/items/fir-tree/thumbnail.webp",
    "src": "/items/fir-tree/model.glb",
    "scale": [
      1,
      1,
      1
    ],
    "offset": [
      -0.01,
      0.05,
      -0.07
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      0.5,
      3,
      0.5
    ]
  },
  
  {
    "id": "tree",
    "category": "outdoor",
    "name": "Tree",
    "thumbnail": "/items/tree/thumbnail.webp",
    "src": "/items/tree/model.glb",
    "scale": [
      0.65,
      0.65,
      0.65
    ],
    "offset": [
      -0.02,
      0.17,
      -0.04
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      1,
      5,
      1
    ]
  },
  

  {
    id: "palm",
    category: "outdoor",
    name: "Palm",
    thumbnail: "/items/palm/thumbnail.webp",
    src: "/items/palm/model.glb",
    scale: [0.37, 0.37, 0.37],
    offset: [0, 0, 0.02],
    rotation: [0, 0, 0],
    dimensions: [1, 4.5, 1],
  },

  {
    "id": "patio-umbrella",
    "category": "outdoor",
    "name": "Patio Umbrella",
    "thumbnail": "/items/patio-umbrella/thumbnail.webp",
    "src": "/items/patio-umbrella/model.glb",
    "scale": [
      1,
      1,
      1
    ],
    "offset": [
      0,
      0,
      0
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      0.5,
      3.7,
      0.5
    ]
  },

  {
    id: "sunbed",
    category: "outdoor",
    name: "Sunbed",
    thumbnail: "/items/sunbed/thumbnail.webp",
    src: "/items/sunbed/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.04, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 1.2, 1.5],
  },

  {
    "id": "window-double",
    "category": "window",
    "name": "Double Window",
    "thumbnail": "/items/window-double/thumbnail.webp",
    "src": "/items/window-double/model.glb",
    "scale": [
      0.81,
      0.81,
      0.81
    ],
    "offset": [
      0,
      -0.32,
      0
    ],
    "rotation": [
      0,
      3.14,
      0
    ],
    "dimensions": [
      1.5,
      1.5,
      0.5
    ],
    "attachTo": "wall"
  },
  
  {
  "id": "window-simple",
  "category": "window",
  "name": "Simple Window",
  "thumbnail": "/items/window-simple/thumbnail.webp",
  "src": "/items/window-simple/model.glb",
  "scale": [
    1,
    1,
    1
  ],
  "offset": [
    1.06,
    -0.21,
    0.05
  ],
  "rotation": [
    0,
    3.14,
    0
  ],
  "dimensions": [
    1.5,
    2,
    0.5
  ],
  "attachTo": "wall"
},


  {
    "id": "window-rectangle",
    "category": "window",
    "name": "Rectangle Window",
    "thumbnail": "/items/window-rectangle/thumbnail.webp",
    "src": "/items/window-rectangle/model.glb",
    "scale": [
      0.81,
      0.81,
      0.81
    ],
    "offset": [
      -1.41,
      -0.28,
      0.08
    ],
    "rotation": [
      0,
      3.14,
      0
    ],
    "dimensions": [
      2.5,
      1.5,
      0.5
    ],
    "attachTo": "wall"
  },

  {
    "id": "door-bar",
    "category": "door",
    "name": "Door with bar",
    "thumbnail": "/items/door-bar/thumbnail.webp",
    "src": "/items/door-bar/model.glb",
    "scale": [
      1,
      1,
      1
    ],
    "offset": [
      -0.48,
      0,
      0
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      1.5,
      2.5,
      0.5
    ],
    "attachTo": "wall"
  },

  {
    id: "glass-door",
    category: "door",
    name: "Glass Door",
    thumbnail: "/items/glass-door/thumbnail.webp",
    src: "/items/glass-door/model.glb",
    scale: [0.9, 0.9, 0.9],
    offset: [-0.52, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1.5, 2.5, 0.4],
    attachTo: "wall",
  },

  {
    "id": "door",
    "category": "door",
    "name": "Door",
    "thumbnail": "/items/door/thumbnail.webp",
    "src": "/items/door/model.glb",
    "scale": [
      0.79,
      0.79,
      0.79
    ],
    "offset": [
      -0.43,
      0,
      0
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      1.5,
      2,
      0.4
    ],
    "attachTo": "wall"
  },

  {
    id: "parking-spot",
    category: "outdoor",
    name: "Parking Spot",
    thumbnail: "/items/parking-spot/thumbnail.webp",
    src: "/items/parking-spot/model.glb",
    scale: [0.9, 1, 0.78],
    offset: [0, 0, 0.01],
    rotation: [0, 0, 0],
    dimensions: [5, 1, 2.5],
  },

  {
    id: "outdoor-playhouse",
    category: "outdoor",
    name: "Outdoor Playhouse",
    thumbnail: "/items/outdoor-playhouse/thumbnail.webp",
    src: "/items/outdoor-playhouse/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.5, 1],
  },

  {
    id: "skate",
    category: "outdoor",
    name: "Skate",
    thumbnail: "/items/skate/thumbnail.webp",
    src: "/items/skate/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 0.2, 0.5],
  },

  {
    id: "scooter",
    category: "outdoor",
    name: "Scooter",
    thumbnail: "/items/scooter/thumbnail.webp",
    src: "/items/scooter/model.glb",
    scale: [1, 1, 1],
    offset: [0.11, 0, 0.17],
    rotation: [0, 0, 0],
    dimensions: [1, 0.9, 0.5],
  },

  {
    id: "basket-hoop",
    category: "outdoor",
    name: "Basket Hoop",
    thumbnail: "/items/basket-hoop/thumbnail.webp",
    src: "/items/basket-hoop/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 1.8, 1],
  },


  {
    id: "ball",
    category: "outdoor",
    name: "Ball",
    thumbnail: "/items/ball/thumbnail.webp",
    src: "/items/ball/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.12, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.3, 0.5],
  },

  {
    id: "wine-bottle",
    category: "kitchen",
    name: "Wine Bottle",
    thumbnail: "/items/wine-bottle/thumbnail.webp",
    src: "/items/wine-bottle/model.glb",
    scale: [1, 1, 1],
    offset: [-0.05, 0, 0.01],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.4, 0.5],
  },

  {
    id: "fruits",
    category: "kitchen",
    name: "Fruits",
    thumbnail: "/items/fruits/thumbnail.webp",
    src: "/items/fruits/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.3, 0.5],
  },

  {
    id: "cutting-board",
    category: "kitchen",
    name: "Cutting Board",
    thumbnail: "/items/cutting-board/thumbnail.webp",
    src: "/items/cutting-board/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.1, 0.5],
  },

  {
    id: "frying-pan",
    category: "kitchen",
    name: "Frying Pan",
    thumbnail: "/items/frying-pan/thumbnail.webp",
    src: "/items/frying-pan/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.1, 1],
  },

  {
    id: "kitchen-utensils",
    category: "kitchen",
    name: "Kitchen Utensils",
    thumbnail: "/items/kitchen-utensils/thumbnail.webp",
    src: "/items/kitchen-utensils/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.5, 0.5],
  },

  {
    id: "microwave",
    category: "kitchen",
    name: "Microwave",
    thumbnail: "/items/microwave/thumbnail.webp",
    src: "/items/microwave/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, -0.03],
    rotation: [0, 0, 0],
    dimensions: [1, 0.3, 0.5],
  },

  {
    id: "stove",
    category: "kitchen",
    name: "Stove",
    thumbnail: "/items/stove/thumbnail.webp",
    src: "/items/stove/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, -0.05],
    rotation: [0, 0, 0],
    dimensions: [1, 1, 1],
  },

  {
    id: "fridge",
    category: "kitchen",
    name: "Fridge",
    thumbnail: "/items/fridge/thumbnail.webp",
    src: "/items/fridge/model.glb",
    scale: [1, 1, 1],
    offset: [0.01, 0, -0.05],
    rotation: [0, 0, 0],
    dimensions: [1, 2, 1],
  },

  {
    id: "hood",
    category: "kitchen",
    name: "Hood",
    thumbnail: "/items/hood/thumbnail.webp",
    src: "/items/hood/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.52, 0.01],
    rotation: [0, 0, 0],
    dimensions: [1.5, 1, 1.1],
    attachTo: "wall-side",
  },

  {
    id: "kitchen-shelf",
    category: "kitchen",
    name: "Kitchen Shelf",
    thumbnail: "/items/kitchen-shelf/thumbnail.webp",
    src: "/items/kitchen-shelf/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.52, 0.01],
    rotation: [0, 0, 0],
    dimensions: [2.5, 1, 1.1],
    attachTo: "wall-side",
  },

  {
    id: "kitchen-counter",
    category: "kitchen",
    name: "Kitchen Counter",
    thumbnail: "/items/kitchen-counter/thumbnail.webp",
    src: "/items/kitchen-counter/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [2, 0.8, 1],
  },

  {
    id: "kitchen-cabinet",
    category: "kitchen",
    name: "Kitchen Cabinet",
    thumbnail: "/items/kitchen-cabinet/thumbnail.webp",
    src: "/items/kitchen-cabinet/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [2, 1.1, 1],
  },

  {
    id: "kitchen",
    category: "kitchen",
    name: "Kitchen",
    thumbnail: "/items/kitchen/thumbnail.webp",
    src: "/items/kitchen/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [2.5, 1.1, 1],
  },

  {
    id: "toilet-paper",
    category: "bathroom",
    name: "Toilet Paper",
    thumbnail: "/items/toilet-paper/thumbnail.webp",
    src: "/items/toilet-paper/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.19, 0.12],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.5, 0.5],
    attachTo: "wall-side",
  },

  {
    id: "shower-rug",
    category: "bathroom",
    name: "Shower Rug",
    thumbnail: "/items/shower-rug/thumbnail.webp",
    src: "/items/shower-rug/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 0.1, 0.5],
  },

  {
    id: "laundry-bag",
    category: "bathroom",
    name: "Laundry Bag",
    thumbnail: "/items/laundry-bag/thumbnail.webp",
    src: "/items/laundry-bag/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.8, 0.5],
  },

  {
    id: "drying-rack",
    category: "bathroom",
    name: "Drying Rack",
    thumbnail: "/items/drying-rack/thumbnail.webp",
    src: "/items/drying-rack/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [2, 1.1, 1],
  },

  {
    id: "washing-machine",
    category: "bathroom",
    name: "Washing Machine",
    thumbnail: "/items/washing-machine/thumbnail.webp",
    src: "/items/washing-machine/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 1, 1],
  },


  {
    id: "toilet",
    category: "bathroom",
    name: "Toilet",
    thumbnail: "/items/toilet/thumbnail.webp",
    src: "/items/toilet/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, -0.23],
    rotation: [0, 0, 0],
    dimensions: [1, 0.9, 1],
  },

  {
    id: "shower-square",
    category: "bathroom",
    name: "Squared Shower",
    thumbnail: "/items/shower-square/thumbnail.webp",
    src: "/items/shower-square/model.glb",
    scale: [1, 1, 1],
    offset: [0.41, 0, -0.42],
    rotation: [0, 0, 0],
    dimensions: [1, 2, 1],
  },

  {
    id: "shower-angle",
    category: "bathroom",
    name: "Angle Shower",
    thumbnail: "/items/shower-angle/thumbnail.webp",
    src: "/items/shower-angle/model.glb",
    scale: [1, 1, 1],
    offset: [0.41, 0, -0.42],
    rotation: [0, 0, 0],
    dimensions: [1, 2, 1],
  },

  {
    id: "bathtub",
    category: "bathroom",
    name: "Bathtub",
    thumbnail: "/items/bathtub/thumbnail.webp",
    src: "/items/bathtub/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0.01],
    rotation: [0, 0, 0],
    dimensions: [2.5, 0.8, 1.5],
  },

  {
    id: "bathroom-sink",
    category: "bathroom",
    name: "Bathroom Sink",
    thumbnail: "/items/bathroom-sink/thumbnail.webp",
    src: "/items/bathroom-sink/model.glb",
    scale: [1, 1, 1],
    offset: [0.11, 0, 0.02],
    rotation: [0, 0, 0],
    dimensions: [2, 1, 1.5],
  },


  {
    id: "ceiling-fan",
    category: "appliance",
    name: "Ceiling fan",
    thumbnail: "/items/ceiling-fan/thumbnail.webp",
    src: "/items/ceiling-fan/model.glb",
    scale: [1, 1, 1],
    offset: [-0.12, 0.49, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 0.5, 1.5],
    attachTo: "ceiling",
  },

  {
    id: "electric-panel",
    category: "appliance",
    name: "Electric Panel",
    thumbnail: "/items/electric-panel/thumbnail.webp",
    src: "/items/electric-panel/model.glb",
    scale: [0.61, 0.74, 0.7],
    offset: [0, 0, 0.06],
    rotation: [0, 0, 0],
    dimensions: [0.5, 1, 0.3],
    attachTo: "wall-side",
  },

  {
    id: "sprinkler",
    category: "appliance",
    name: "Sprinkler",
    thumbnail: "/items/sprinkler/thumbnail.webp",
    src: "/items/sprinkler/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.45, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.5, 0.5],
    attachTo: "ceiling",
  },

  {
    id: "smoke-detector",
    category: "appliance",
    name: "Smoke Detector",
    thumbnail: "/items/smoke-detector/thumbnail.webp",
    src: "/items/smoke-detector/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.49, 0],
    rotation: [Math.PI, 0, 0],
    dimensions: [0.5, 0.5, 0.5],
    attachTo: "ceiling",
  },
  

  {
    id: "fire-detector",
    category: "appliance",
    name: "Fire Detector",
    thumbnail: "/items/fire-detector/thumbnail.webp",
    src: "/items/fire-detector/model.glb",
    scale: [0.9, 1.4, 0.7],
    offset: [0.02, 0.05, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.5, 0.3],
    attachTo: "wall",
  },

  {
    id: "exit-sign",
    category: "appliance",
    name: "Exit Sign",
    thumbnail: "/items/exit-sign/thumbnail.webp",
    src: "/items/exit-sign/model.glb",
    scale: [0.6, 0.5, 0.7],
    offset: [0, 0.04, 0.05],
    rotation: [0, 0, 0],
    dimensions: [1, 0.5, 0.3],
    attachTo: "wall-side",
  },

  {
    id: "hydrant",
    category: "appliance",
    name: "Hydrant",
    thumbnail: "/items/hydrant/thumbnail.webp",
    src: "/items/hydrant/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 0.9, 1],
  },

  {
    id: "alarm-keypad",
    category: "appliance",
    name: "Alarm Keypad",
    thumbnail: "/items/alarm-keypad/thumbnail.webp",
    src: "/items/alarm-keypad/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.1, 0.5],
  },


  {
    id: "thermostat",
    category: "appliance",
    name: "Thermostat",
    thumbnail: "/items/thermostat/thumbnail.webp",
    src: "/items/thermostat/model.glb",
    scale: [2.08, 2.1, 2.59],
    offset: [0, 0, 0.01],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.5, 0.1],
    attachTo: "wall-side",
  },

  {
    id: "air-conditioning",
    category: "appliance",
    name: "Air Conditioning",
    thumbnail: "/items/air-conditioning/thumbnail.webp",
    src: "/items/air-conditioning/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.37, 0.21],
    rotation: [0, 0, 0],
    dimensions: [2, 1, 0.9],
    attachTo: "wall-side",
  },

  {
    id: "ac-block",
    category: "appliance",
    name: "AC block",
    thumbnail: "/items/ac-block/thumbnail.webp",
    src: "/items/ac-block/model.glb",
    scale: [0.79, 0.79, 0.79],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1.1, 1, 1.1],
  },

  {
    id: "toaster",
    category: "appliance",
    name: "Toaster",
    thumbnail: "/items/toaster/thumbnail.webp",
    src: "/items/toaster/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.3, 0.5],
  },

  {
    id: "sewing-machine",
    category: "appliance",
    name: "Sewing Machine",
    thumbnail: "/items/sewing-machine/thumbnail.webp",
    src: "/items/sewing-machine/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 0.7, 0.5],
  },


  {
    id: "kettle",
    category: "appliance",
    name: "Kettle",
    thumbnail: "/items/kettle/thumbnail.webp",
    src: "/items/kettle/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.3, 0.5],
  },

  {
    id: "iron",
    category: "appliance",
    name: "Iron",
    thumbnail: "/items/iron/thumbnail.webp",
    src: "/items/iron/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.3, 0.5],
  },

  {
    id: "coffee-machine",
    category: "appliance",
    name: "Coffee Machine",
    thumbnail: "/items/coffee-machine/thumbnail.webp",
    src: "/items/coffee-machine/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, -0.03],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.3, 0.5],
  },

  {
    id: "television",
    category: "appliance",
    name: "Television",
    thumbnail: "/items/television/thumbnail.webp",
    src: "/items/television/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [2, 1.1, 0.5],
  },


  {
    id: "computer",
    category: "appliance",
    name: "Computer",
    thumbnail: "/items/computer/thumbnail.webp",
    src: "/items/computer/model.glb",
    scale: [1, 1, 1],
    offset: [0.01, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 0.5, 0.5],
  },

  {
    id: "stereo-speaker",
    category: "appliance",
    name: "Stereo Speaker",
    thumbnail: "/items/stereo-speaker/thumbnail.webp",
    src: "/items/stereo-speaker/model.glb",
    scale: [1, 1, 1],
    offset: [0.02, 0, -0.01],
    rotation: [0, 0, 0],
    dimensions: [0.5, 1.1, 0.5],
  },



  {
    id: "threadmill",
    category: "furniture",
    name: "Threadmill",
    thumbnail: "/items/threadmill/thumbnail.webp",
    src: "/items/threadmill/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [2.5, 1.5, 1],
  },


  {
    id: "barbell-stand",
    category: "furniture",
    name: "Barbell Stand",
    thumbnail: "/items/barbell-stand/thumbnail.webp",
    src: "/items/barbell-stand/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1.5, 1.3, 2],
  },

  {
    id: "barbell",
    category: "furniture",
    name: "Barbell",
    thumbnail: "/items/barbell/thumbnail.webp",
    src: "/items/barbell/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.4, 2],
  },

  {
    id: "toy",
    category: "furniture",
    name: "Toy",
    thumbnail: "/items/toy/thumbnail.webp",
    src: "/items/toy/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.5, 0.5],
  },


  {
    id: "car-toy",
    category: "furniture",
    name: "Car Toy",
    thumbnail: "/items/car-toy/thumbnail.webp",
    src: "/items/car-toy/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.4, 1],
  },

  {
    id: "easel",
    category: "furniture",
    name: "Easel",
    thumbnail: "/items/easel/thumbnail.webp",
    src: "/items/easel/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1.5, 2.3, 1],
  },

  {
    id: "pool-table",
    category: "furniture",
    name: "Pool table",
    thumbnail: "/items/pool-table/thumbnail.webp",
    src: "/items/pool-table/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [2.5, 1, 4],
  },

  {
    id: "guitar",
    category: "furniture",
    name: "Guitar",
    thumbnail: "/items/guitar/thumbnail.webp",
    src: "/items/guitar/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.32, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 1.2, 0.5],
  },

  {
    id: "piano",
    category: "furniture",
    name: "Piano",
    thumbnail: "/items/piano/thumbnail.webp",
    src: "/items/piano/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [2, 1.5, 1],
  },

  {
    id: "round-carpet",
    category: "furniture",
    name: "Round Carpet",
    thumbnail: "/items/round-carpet/thumbnail.webp",
    src: "/items/round-carpet/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [2.5, 0.1, 2.5],
  },

  {
    id: "rectangular-carpet",
    category: "furniture",
    name: "Rectangular Carpet",
    thumbnail: "/items/rectangular-carpet/thumbnail.webp",
    src: "/items/rectangular-carpet/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [3, 0.1, 2],
  },

  {
    id: "cactus",
    category: "furniture",
    name: "Cactus",
    thumbnail: "/items/cactus/thumbnail.webp",
    src: "/items/cactus/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.4, 0.5],
  },

  {
    id: "small-indoor-plant",
    category: "furniture",
    name: "Small Plant",
    thumbnail: "/items/small-indoor-plant/thumbnail.webp",
    src: "/items/small-indoor-plant/model.glb",
    scale: [1, 1, 1],
    offset: [-0.01, 0, 0.01],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.7, 0.5],
  },

  {
    id: "indoor-plant",
    category: "furniture",
    name: "Indoor Plant",
    thumbnail: "/items/indoor-plant/thumbnail.webp",
    src: "/items/indoor-plant/model.glb",
    scale: [1, 1, 1],
    offset: [-0.05, 0, 0.07],
    rotation: [0, 0, 0],
    dimensions: [1, 1.7, 1],
  },

  {
    id: "ironing-board",
    category: "furniture",
    name: "Ironing Board",
    thumbnail: "/items/ironing-board/thumbnail.webp",
    src: "/items/ironing-board/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1.5, 1, 1],
  },

  {
    id: "coat-rack",
    category: "furniture",
    name: "Coat Rack",
    thumbnail: "/items/coat-rack/thumbnail.webp",
    src: "/items/coat-rack/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 1.8, 0.5],
  },

  {
    id: "trash-bin",
    category: "furniture",
    name: "Trash Bin",
    thumbnail: "/items/trash-bin/thumbnail.webp",
    src: "/items/trash-bin/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.6, 0.5],
  },

  {
    id: "round-mirror",
    category: "furniture",
    name: "Rounded Mirror",
    thumbnail: "/items/round-mirror/thumbnail.webp",
    src: "/items/round-mirror/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.32, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 1, 0.1],
    attachTo: "wall-side",
  },

  {
    id: "picture",
    category: "furniture",
    name: "Picture",
    thumbnail: "/items/picture/thumbnail.webp",
    src: "/items/picture/model.glb",
    scale: [1, 1, 1],
    offset: [0.02, 0.45, 0.01],
    rotation: [0, 0, 0],
    dimensions: [2, 1, 0.2],
    attachTo: "wall-side",
  },

  {
    id: "books",
    category: "furniture",
    name: "Books",
    thumbnail: "/items/books/thumbnail.webp",
    src: "/items/books/model.glb",
    scale: [1, 1, 1],
    offset: [-0.08, 0, 0.02],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.3, 0.5],
  },

  {
    "id": "column",
    "category": "furniture",
    "name": "Column",
    "thumbnail": "/items/column/thumbnail.webp",
    "src": "/items/column/model.glb",
    "scale": [
      1,
      1,
      1
    ],
    "offset": [
      0,
      1.26,
      0
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      0.5,
      2.6,
      0.5
    ]
  },
  
  {
    "id": "stairs",
    "category": "furniture",
    "name": "Stairs",
    "thumbnail": "/items/stairs/thumbnail.webp",
    "src": "/items/stairs/model.glb",
    "scale": [
      0.61,
      0.61,
      0.61
    ],
    "offset": [
      0,
      0.03,
      1.8
    ],
    "rotation": [
      0,
      0,
      0
    ],
    "dimensions": [
      1.5,
      2.5,
      3.5
    ]
  },

  {
    id: "suspended-fireplace",
    category: "furniture",
    name: "Suspended Fireplace",
    thumbnail: "/items/suspended-fireplace/thumbnail.webp",
    src: "/items/suspended-fireplace/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.45, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.5, 0.5],
    attachTo: "ceiling",
  },

  {
    id: "tv-stand",
    category: "furniture",
    name: "TV Stand",
    thumbnail: "/items/tv-stand/thumbnail.webp",
    src: "/items/tv-stand/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.21, 0],
    rotation: [0, 0, 0],
    dimensions: [2, 0.4, 0.5],
  },

  {
    id: "shelf",
    category: "furniture",
    name: "Shelf",
    thumbnail: "/items/shelf/thumbnail.webp",
    src: "/items/shelf/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.1, 0.01],
    rotation: [0, 0, 0],
    dimensions: [1, 0.5, 0.7],
    attachTo: "wall-side",
  },

  {
    id: "bookshelf",
    category: "furniture",
    name: "Bookshelf",
    thumbnail: "/items/bookshelf/thumbnail.webp",
    src: "/items/bookshelf/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 2, 0.5],
  },

  {
    id: "ceiling-lamp",
    category: "furniture",
    name: "Ceiling Lamp",
    thumbnail: "/items/ceiling-lamp/thumbnail.webp",
    src: "/items/ceiling-lamp/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0.98, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 1, 1],
    attachTo: "ceiling",
  },

  {
    id: "floor-lamp",
    category: "furniture",
    name: "Floor Lamp",
    thumbnail: "/items/floor-lamp/thumbnail.webp",
    src: "/items/floor-lamp/model.glb",
    scale: [1, 1, 1],
    offset: [0.04, 0, 0.02],
    rotation: [0, 0, 0],
    dimensions: [1, 1.9, 1],
  },

  {
    id: "table-lamp",
    category: "furniture",
    name: "Table Lamp",
    thumbnail: "/items/table-lamp/thumbnail.webp",
    src: "/items/table-lamp/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.8, 1],
  },


  {
    id: "closet",
    category: "furniture",
    name: "Closet",
    thumbnail: "/items/closet/thumbnail.webp",
    src: "/items/closet/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, -0.01],
    rotation: [0, 0, 0],
    dimensions: [2, 2.5, 1],
  },

  {
    id: "dresser",
    category: "furniture",
    name: "Dresser",
    thumbnail: "/items/dresser/thumbnail.webp",
    src: "/items/dresser/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1.5, 0.8, 1],
  },

  {
    id: "bunkbed",
    category: "furniture",
    name: "Bunkbed",
    thumbnail: "/items/bunkbed/thumbnail.webp",
    src: "/items/bunkbed/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, -0.09],
    rotation: [0, 0, 0],
    dimensions: [2, 1.6, 1.5],
  },

  {
    id: "double-bed",
    category: "furniture",
    name: "Double Bed",
    thumbnail: "/items/double-bed/thumbnail.webp",
    src: "/items/double-bed/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, -0.03],
    rotation: [0, 0, 0],
    dimensions: [2, 0.8, 2.5],
  },

  {
    id: "single-bed",
    category: "furniture",
    name: "Single Bed",
    thumbnail: "/items/single-bed/thumbnail.webp",
    src: "/items/single-bed/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1.5, 0.7, 2.5],
  },


  {
    id: "sofa",
    category: "furniture",
    name: "Sofa",
    thumbnail: "/items/sofa/thumbnail.webp",
    src: "/items/sofa/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0.04],
    rotation: [0, 0, 0],
    dimensions: [2.5, 0.8, 1.5],
  },

  {
    id: "lounge-chair",
    category: "furniture",
    name: "Lounge Chair",
    thumbnail: "/items/lounge-chair/thumbnail.webp",
    src: "/items/lounge-chair/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0.09],
    rotation: [0, 0, 0],
    dimensions: [1, 1.1, 1.5],
  },

  {
    id: "stool",
    category: "furniture",
    name: "Stool",
    thumbnail: "/items/stool/thumbnail.webp",
    src: "/items/stool/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1, 1.2, 1],
  },

  {
    id: "dining-chair",
    category: "furniture",
    name: "Dining Chair",
    thumbnail: "/items/dining-chair/thumbnail.webp",
    src: "/items/dining-chair/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 1, 0.5],
  },

  {
    id: "office-chair",
    category: "furniture",
    name: "Office Chair",
    thumbnail: "/items/office-chair/thumbnail.webp",
    src: "/items/office-chair/model.glb",
    scale: [1, 1, 1],
    offset: [0.01, 0, 0.03],
    rotation: [0, 0, 0],
    dimensions: [1, 1.2, 1],
  },

  {
    id: "livingroom-chair",
    category: "furniture",
    name: "Livingroom Chair",
    thumbnail: "/items/livingroom-chair/thumbnail.webp",
    src: "/items/livingroom-chair/model.glb",
    scale: [1, 1, 1],
    offset: [0.01, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [1.5, 0.8, 1.5],
  },

  {
    id: "bedside-table",
    category: "furniture",
    name: "Bedside Table",
    thumbnail: "/items/bedside-table/thumbnail.webp",
    src: "/items/bedside-table/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, -0.01],
    rotation: [0, 0, 0],
    dimensions: [0.5, 0.5, 0.5],
  },

  {
    id: "coffee-table",
    category: "furniture",
    name: "Coffee Table",
    thumbnail: "/items/coffee-table/thumbnail.webp",
    src: "/items/coffee-table/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [2, 0.4, 1.5],
  },

  {
    id: "office-table",
    category: "furniture",
    name: "Office Table",
    thumbnail: "/items/office-table/thumbnail.webp",
    src: "/items/office-table/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    dimensions: [2, 0.8, 1],
  },

  {
    id: "dining-table",
    category: "furniture",
    name: "Dining Table",
    thumbnail: "/items/dining-table/thumbnail.webp",
    src: "/items/dining-table/model.glb",
    scale: [1, 1, 1],
    offset: [0, 0, -0.01],
    rotation: [0, 0, 0],
    dimensions: [2.5, 0.8, 1],
  },
];
