# IFC Test Files

This list describes the 10 real-world IFC (Industry Foundation Classes) example files that the converter app offers for testing. Four of them (01, 04, 05 and 10) are checked in here and served from the app's `public/` folder; the other six (02, 03 and 06–09) are fetched at runtime from a public Supabase Storage bucket (`lib/test-files.ts`). They are BIM models exported from authoring tools such as Revit and ArchiCAD, gathered from public repositories. Being publicly downloadable does not mean they may be reused: see [Licence status](#licence-status) before using any of them.

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

None of the ten example files has a verified licence that allows redistributing the model or derived work. Use them as local converter test inputs: keep conversions, renders and scores made from them internal, do not publish them, and do not add another model without a stated licence.

| File | Where it is served from | Origin | Licence status |
|---|---|---|---|
| 01-duplex.ifc | this directory | NIBS Common BIM Files "Duplex Apartment" (Revit export), copied from xeokit-sdk | Conflicting. The buildingSMART community sample-files repo relicenses the NIBS set as CC BY 4.0; the original NIBS page, now offline, reportedly carried a CC BY-ND 3.0 (no derivatives) footer. |
| 02-schependomlaan.ifc | Supabase bucket | "10 Appartementen Schependomlaan", via xeokit-sdk / buildingSMART sample files | Not verified: no licence recorded for the model. |
| 03-rac-sample-project.ifc | Supabase bucket | Autodesk Revit "RAC" advanced sample project, via xeokit-sdk | Autodesk sample content; no redistribution grant found. |
| 04-ifc-open-house.ifc | this directory | Output of IfcOpenShell's `src/examples/IfcOpenHouse.cpp`, copied from xeokit-sdk | The generator code is LGPL-3.0. No licence is stated for the generated model. |
| 05-paris-ground-floor.ifc | this directory | Copied from xeokit-sdk | No licence recorded for the model. |
| 06-sample-castle.ifc | Supabase bucket | youshengCode/IfcSampleFiles | The repository has no licence; its README says only that the files are for software testing. |
| 07-revit-architectural.ifc | Supabase bucket | youshengCode/IfcSampleFiles | Same as 06: no licence. |
| 08-revit-mep.ifc | Supabase bucket | youshengCode/IfcSampleFiles | Same as 06: no licence. |
| 09-revit-structural.ifc | Supabase bucket | youshengCode/IfcSampleFiles | Same as 06: no licence. |
| 10-sample-house.ifc | this directory | youshengCode/IfcSampleFiles | Same as 06: no licence. |

xeokit-sdk is licensed AGPL-3.0, not GPL-3.0 as this file used to say, and that licence covers its code, not the models it bundles.

**Open question (owner decision pending).** The four files above are still published in this public repository, the app auto-loads 01-duplex.ifc and offers every example (including the six from the public bucket) for conversion and download of the result. Whether to remove them from the repository, from the app's picker and auto-load, or from the bucket has not been decided. Until it is, nothing has been removed; this section only records their status.

## References

- [buildingSMART International](https://www.buildingsmart.org/) - IFC standard organization
- [xeokit](https://xeokit.io/) - Open-source WebGL-based 3D BIM viewer
- [IFC.js](https://ifcjs.github.io/info/) - JavaScript library for IFC file processing
