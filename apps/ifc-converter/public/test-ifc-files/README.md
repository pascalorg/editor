# IFC Test Files

This list describes 10 real-world IFC (Industry Foundation Classes) files collected for testing the IFC to Pascal converter; four of them (01, 04, 05 and 10) are checked in here. See [Licence status](#licence-status) before using any of them. All files are from open-source repositories and represent actual BIM models exported from professional software like Revit, ArchiCAD, and other authoring tools.

## Files

### 01-duplex.ifc (1.2 MB)
- **Source**: [xeokit-sdk](https://github.com/xeokit/xeokit-sdk/tree/master/assets/models/ifc)
- **Description**: Duplex apartment model (IFC 2x3)
- **Created**: 2015-11-12
- **Software**: IFC Tools Project - IFC2x3 Java Toolbox
- **Use Case**: Residential building, multi-level apartment

### 02-schependomlaan.ifc (47 MB)
- **Source**: [xeokit-sdk](https://github.com/xeokit/xeokit-sdk/tree/master/assets/models/ifc) / buildingSMART Sample Files
- **Description**: "10 Appartementen Schependomlaan" - Large Dutch apartment complex
- **Use Case**: Large-scale residential building, complex spatial hierarchy
- **Note**: One of the most widely used IFC test files in the community

### 03-rac-sample-project.ifc (43 MB)
- **Source**: [xeokit-sdk](https://github.com/xeokit/xeokit-sdk/tree/master/assets/models/ifc)
- **Description**: RAC (Revit Architecture) Advanced Sample Project
- **Software**: Autodesk Revit
- **Use Case**: Large commercial/office building with detailed architectural elements

### 04-ifc-open-house.ifc (111 KB)
- **Source**: [xeokit-sdk](https://github.com/xeokit/xeokit-sdk/tree/master/assets/models/ifc)
- **Description**: IFC Open House (IFC4 schema)
- **Use Case**: Small residential building, IFC4 format example

### 05-paris-ground-floor.ifc (3.9 MB)
- **Source**: [xeokit-sdk](https://github.com/xeokit/xeokit-sdk/tree/master/assets/models/ifc)
- **Description**: 19 rue Marc Antoine Petit - Ground floor, Paris building
- **Use Case**: European architectural model, single floor representation

### 06-sample-castle.ifc (47 MB)
- **Source**: [youshengCode/IfcSampleFiles](https://github.com/youshengCode/IfcSampleFiles)
- **Description**: Sample Castle (IFC 2x3)
- **Use Case**: Historic/complex architectural geometry, demonstration model

### 07-revit-architectural.ifc (13 MB)
- **Source**: [youshengCode/IfcSampleFiles](https://github.com/youshengCode/IfcSampleFiles)
- **Description**: Revit Architectural model (IFC4)
- **Software**: Autodesk Revit
- **Use Case**: Architectural discipline model from Revit

### 08-revit-mep.ifc (28 MB)
- **Source**: [youshengCode/IfcSampleFiles](https://github.com/youshengCode/IfcSampleFiles)
- **Description**: Revit MEP (Mechanical, Electrical, Plumbing) model (IFC4)
- **Software**: Autodesk Revit MEP
- **Use Case**: Building systems - HVAC, electrical, plumbing elements

### 09-revit-structural.ifc (11 MB)
- **Source**: [youshengCode/IfcSampleFiles](https://github.com/youshengCode/IfcSampleFiles)
- **Description**: Revit Structural model (IFC4)
- **Software**: Autodesk Revit Structure
- **Use Case**: Structural engineering discipline - beams, columns, foundations

### 10-sample-house.ifc (2.2 MB)
- **Source**: [youshengCode/IfcSampleFiles](https://github.com/youshengCode/IfcSampleFiles)
- **Description**: Sample House (IFC4)
- **Use Case**: Residential building, complete house model with multiple building elements

## Schema Versions

- **IFC 2x3**: Files 01, 02, 06 (widely used, mature standard)
- **IFC4**: Files 03, 04, 07, 08, 09, 10 (newer standard with enhanced capabilities)

## Testing Coverage

These files cover:
- **Building Types**: Residential (apartments, houses), Commercial (office buildings), Historic (castle)
- **Disciplines**: Architecture, MEP (mechanical/electrical/plumbing), Structural
- **Software Sources**: Autodesk Revit, IFC Tools, various BIM authoring tools
- **Complexity**: From simple houses (111 KB) to large complexes (47 MB)
- **Geographic Origins**: European (Netherlands, France) and International models

## Licence status

Only 01, 04, 05 and 10 are in this directory; the other entries above describe where the rest of the original set came from. None of the four has a verified licence that allows redistributing the model or derived work. Use them as local converter test inputs: keep conversions, renders and scores made from them internal, do not publish them, and do not add another model here without a stated licence.

| File | Origin | Licence status |
|---|---|---|
| 01-duplex.ifc | NIBS Common BIM Files "Duplex Apartment" (Revit export), copied from xeokit-sdk | Conflicting. The buildingSMART community sample-files repo relicenses the NIBS set as CC BY 4.0; the original NIBS page, now offline, reportedly carried a CC BY-ND 3.0 (no derivatives) footer. |
| 04-ifc-open-house.ifc | Output of IfcOpenShell's `src/examples/IfcOpenHouse.cpp`, copied from xeokit-sdk | The generator code is LGPL-3.0. No licence is stated for the generated model. |
| 05-paris-ground-floor.ifc | Copied from xeokit-sdk | No licence recorded for the model. |
| 10-sample-house.ifc | youshengCode/IfcSampleFiles | The repository has no licence; its README says only that the files are for software testing. |

xeokit-sdk is licensed AGPL-3.0, not GPL-3.0 as this file used to say, and that licence covers its code, not the models it bundles.

## References

- [buildingSMART International](https://www.buildingsmart.org/) - IFC standard organization
- [xeokit](https://xeokit.io/) - Open-source WebGL-based 3D BIM viewer
- [IFC.js](https://ifcjs.github.io/info/) - JavaScript library for IFC file processing
