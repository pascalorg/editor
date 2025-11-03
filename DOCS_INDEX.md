# Documentation Index

Quick guide to all documentation in the project.

## 📚 Main Documentation (Root)

### README.md (646B)
**Main project readme** - Overview of the building editor

### ENGINE_WIKI.md (30KB) ⭐ **START HERE**
**Comprehensive engine and catalog reference** - Everything you need to know:
- Quick start guide
- Architecture overview
- Core concepts (entities, components, systems)
- Catalog system
- Complete API reference
- Code examples
- Adding elements guide
- Performance tips
- Troubleshooting

### ARCHITECTURE.md (16KB)
**System architecture deep dive** - Detailed technical documentation:
- Node tree architecture
- ECS runtime design
- Catalog integration
- Data flow diagrams
- File organization
- Design decisions
- Migration path

---

## 🔧 Engine Documentation (lib/engine/)

### README.md (~12KB)
**Engine-specific API reference** - Deep dive into ECS internals:
- World class API
- Component system details
- Registry internals
- Adapter mechanics
- System implementation
- Strategy functions

### EXAMPLES.md (~12KB)
**Code examples** - Practical usage examples:
- World creation
- Component queries
- Custom systems
- Integration patterns
- Performance monitoring

---

## 📦 Catalog Documentation (lib/catalog/)

### README.md (6KB)
**Catalog guide** - Element organization and management:
- Catalog structure
- Element organization
- Adding new elements
- Spec format details
- Metadata system
- Remote catalog (future)

---

## 🎯 Quick Navigation

### I want to...

**Get started quickly**
→ Read `ENGINE_WIKI.md` (Quick Start section)

**Understand the architecture**
→ Read `ARCHITECTURE.md` + `ENGINE_WIKI.md` (Architecture section)

**Add a new element**
→ Read `ENGINE_WIKI.md` (Adding Elements section)

**See code examples**
→ Read `ENGINE_WIKI.md` (Code Examples section) or `lib/engine/EXAMPLES.md`

**Learn the engine API**
→ Read `lib/engine/README.md` for details, `ENGINE_WIKI.md` for quick ref

**Understand the catalog**
→ Read `lib/catalog/README.md` or `ENGINE_WIKI.md` (Catalog section)

**Debug performance issues**
→ Read `ENGINE_WIKI.md` (Performance section)

**Extend the system**
→ Read `ENGINE_WIKI.md` (Adding Elements + API Reference)

---

## 📖 Reading Order

### For New Developers

1. **README.md** (2 min) - Project overview
2. **ENGINE_WIKI.md** (15 min) - Comprehensive guide
3. **ARCHITECTURE.md** (20 min) - Deep technical dive
4. **lib/engine/EXAMPLES.md** (10 min) - Practical examples

**Total:** ~45 minutes to full understanding

### For Quick Reference

Just read **ENGINE_WIKI.md** - has everything you need!

### For Deep Dives

1. **ENGINE_WIKI.md** - Complete overview
2. **lib/engine/README.md** - Engine internals
3. **lib/catalog/README.md** - Catalog details
4. **ARCHITECTURE.md** - System design

---

## 📊 Documentation Statistics

| File | Size | Purpose | Audience |
|------|------|---------|----------|
| **README.md** | 646B | Project overview | Everyone |
| **ENGINE_WIKI.md** ⭐ | 30KB | Complete reference | Everyone |
| **ARCHITECTURE.md** | 16KB | System design | Developers |
| **lib/engine/README.md** | 12KB | Engine API | Advanced |
| **lib/engine/EXAMPLES.md** | 12KB | Code examples | Developers |
| **lib/catalog/README.md** | 6KB | Catalog guide | Developers |

**Total:** ~75KB of documentation

---

## 🎓 Learning Paths

### Path 1: User (5 minutes)
1. Read ENGINE_WIKI.md → Quick Start
2. Try the editor
3. See bounding boxes

### Path 2: Developer (45 minutes)
1. README.md → Overview
2. ENGINE_WIKI.md → Complete guide
3. ARCHITECTURE.md → System design
4. lib/engine/EXAMPLES.md → Code patterns

### Path 3: Contributor (1 hour)
1. All of Path 2
2. lib/engine/README.md → Engine internals
3. lib/catalog/README.md → Catalog details
4. Try adding a custom element

---

## 🔍 Quick Reference

### Documentation by Topic

| Topic | Primary Doc | Details |
|-------|-------------|---------|
| **Quick Start** | ENGINE_WIKI.md | Getting started |
| **Architecture** | ARCHITECTURE.md | System design |
| **ECS Core** | lib/engine/README.md | Engine internals |
| **Catalog** | lib/catalog/README.md | Element system |
| **API Reference** | ENGINE_WIKI.md | Complete API |
| **Code Examples** | ENGINE_WIKI.md, lib/engine/EXAMPLES.md | Patterns |
| **Adding Elements** | ENGINE_WIKI.md | Step-by-step |
| **Performance** | ENGINE_WIKI.md | Optimization |
| **Troubleshooting** | ENGINE_WIKI.md | Common issues |

---

## ✅ Documentation Best Practices

### Maintained

These docs are actively maintained:
- ✅ ENGINE_WIKI.md
- ✅ ARCHITECTURE.md
- ✅ lib/engine/README.md
- ✅ lib/engine/EXAMPLES.md
- ✅ lib/catalog/README.md
- ✅ README.md

### Structure

- **Root docs** - High-level guides
- **lib/*/README.md** - Module-specific details
- **ENGINE_WIKI.md** - One-stop reference

### Updates

When making changes:
1. Update ENGINE_WIKI.md first (canonical reference)
2. Update module README if needed (lib/engine, lib/catalog)
3. Update ARCHITECTURE.md for design changes
4. Keep docs in sync

---

## 🚀 Next Steps

After reading docs:

1. ✅ **Try it** - Start editor, see bounding boxes
2. ✅ **Explore code** - Check `lib/catalog/structure/`
3. ✅ **Add element** - Follow ENGINE_WIKI.md guide
4. ✅ **Experiment** - Query World, try examples
5. ✅ **Extend** - Create custom elements

---

**Happy reading!** 📖

For questions or issues, check ENGINE_WIKI.md first!

