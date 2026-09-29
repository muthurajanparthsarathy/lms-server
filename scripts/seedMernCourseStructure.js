// Sample course structure + pedagogy hours for the "MERN Development" course
// (SYN-BTB-TD-001), so the pedagogy builder has a full, realistic course to
// work with: 10 modules → 5 sub modules each → 2-3 topics each → 5 sub topics
// each, a Level on every sub topic, one skill per module, and I Do / We Do /
// You Do hours on every sub topic using the course's own activity names.
//
// Everything written is tagged createdBy = SEED_BY, so it can be removed again
// without touching anything a person added:
//
//   node scripts/seedMernCourseStructure.js            # add (refuses if the course already has modules)
//   node scripts/seedMernCourseStructure.js --remove   # delete only what this script added
//
// Run from the server folder.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const CourseStructure = require("../models/Courses/courseStructureModal");
const Module1 = require("../models/Courses/moduleStructure/moduleModal");
const SubModule1 = require("../models/Courses/moduleStructure/subModuleModal");
const Topic1 = require("../models/Courses/moduleStructure/topicModal");
const SubTopic1 = require("../models/Courses/moduleStructure/subTopicModal");
const PedagogyView = require("../models/Courses/moduleStructure/pedagogyViewModal");
const LevelView = require("../models/Courses/moduleStructure/levelModel");

const COURSE_ID = "6ab6059b85ea34653106b190";
const SEED_BY = "seed-mern-course-structure";

// module → 5 sub modules → 2-3 topics each. Every topic gets 5 sub topics
// (see SUB_TOPICS_FOR). `skill` is the ONE skill every item in that module is
// tagged with, taken from the course's own skill list.
const CURRICULUM = [
    { title: "JavaScript Foundations", skill: { frontend: ["js"] }, subModules: [
        ["Core Syntax", ["Variables & Data Types", "Operators & Expressions", "Control Flow"]],
        ["Functions", ["Function Declarations & Arrows", "Scope & Closures"]],
        ["Arrays & Objects", ["Array Methods", "Objects & JSON", "Destructuring & Spread"]],
        ["Asynchronous JavaScript", ["Callbacks & Promises", "Async / Await"]],
        ["Modern JavaScript", ["ES Modules", "Classes & Prototypes", "Error Handling"]],
    ] },
    { title: "Git, Tooling & Workflow", skill: { frontend: ["js"] }, subModules: [
        ["Git Basics", ["Repositories & Commits", "Viewing History"]],
        ["Branching Strategies", ["Feature Branches", "Merging & Rebasing"]],
        ["Collaboration on GitHub", ["Pull Requests", "Code Reviews", "Issues & Projects"]],
        ["Package Management", ["npm & package.json", "Semantic Versioning"]],
        ["Code Quality Tools", ["ESLint & Prettier", "Debugging in VS Code"]],
    ] },
    { title: "HTML5 & CSS3", skill: { frontend: ["html"] }, subModules: [
        ["Semantic HTML", ["Document Structure", "Semantic Elements", "Accessibility"]],
        ["Forms & Media", ["HTML Forms", "Images, Audio & Video"]],
        ["CSS Fundamentals", ["Selectors & Specificity", "The Box Model", "Typography & Colours"]],
        ["Layouts", ["Flexbox", "CSS Grid"]],
        ["Responsive Design", ["Media Queries", "Mobile-first Design", "CSS Animations"]],
    ] },
    { title: "React Fundamentals", skill: { frontend: ["react"] }, subModules: [
        ["Components & JSX", ["JSX Syntax", "Function Components"]],
        ["Props & Composition", ["Passing Props", "Children & Composition", "Conditional Rendering"]],
        ["State Management Basics", ["useState", "Lifting State Up"]],
        ["Events & Forms", ["Event Handling", "Controlled Forms", "Form Validation"]],
        ["Effects & Data", ["useEffect", "Fetching Data"]],
    ] },
    { title: "Advanced React", skill: { frontend: ["react"] }, subModules: [
        ["React Router", ["Routes & Links", "Dynamic & Nested Routes"]],
        ["Context & Reducers", ["Context API", "useReducer", "Custom Hooks"]],
        ["Redux Toolkit", ["Store & Slices", "Async Thunks"]],
        ["Performance", ["Memoisation", "Code Splitting", "Profiling Renders"]],
        ["Next.js Essentials", ["Pages & App Router", "Server Components"]],
    ] },
    { title: "Node.js Core", skill: { frontend: ["js"] }, subModules: [
        ["Node Runtime", ["The Event Loop", "Module Systems"]],
        ["File System & Paths", ["Reading & Writing Files", "Working with Paths"]],
        ["Events & Streams", ["EventEmitter", "Readable & Writable Streams", "Piping Streams"]],
        ["HTTP Module", ["Creating a Server", "Handling Requests"]],
        ["Configuration & Logging", ["Environment Variables", "Logging", "Graceful Shutdown"]],
    ] },
    { title: "Express.js & REST APIs", skill: { frontend: ["js"] }, subModules: [
        ["Express Setup", ["Project Structure", "Routing Basics"]],
        ["Middleware", ["Built-in Middleware", "Custom Middleware", "Error Middleware"]],
        ["REST API Design", ["Resources & Verbs", "Status Codes"]],
        ["Validation & Errors", ["Request Validation", "Centralised Error Handling"]],
        ["API Documentation & Testing", ["Swagger / OpenAPI", "Postman Collections", "Versioning APIs"]],
    ] },
    { title: "MongoDB & Mongoose", skill: { frontend: ["js"] }, subModules: [
        ["MongoDB Basics", ["Documents & Collections", "CRUD Operations"]],
        ["Querying Data", ["Filters & Projections", "Sorting & Pagination", "Indexes"]],
        ["Mongoose Schemas", ["Schemas & Models", "Validation"]],
        ["Relationships", ["References & populate", "Embedding vs Referencing"]],
        ["Aggregation", ["Pipeline Stages", "Grouping & Lookups", "Transactions"]],
    ] },
    { title: "Authentication & Security", skill: { frontend: ["js"] }, subModules: [
        ["Password Security", ["Hashing with bcrypt", "Password Reset Flow"]],
        ["JSON Web Tokens", ["Issuing Tokens", "Refresh Tokens"]],
        ["Authorisation", ["Role-based Access", "Protected Routes", "Session Management"]],
        ["Web Vulnerabilities", ["XSS & CSRF", "Injection Attacks"]],
        ["Hardening the App", ["Helmet & CORS", "Rate Limiting", "Secrets Management"]],
    ] },
    { title: "Capstone MERN Project", skill: { frontend: ["next"] }, subModules: [
        ["Project Planning", ["Requirements & User Stories", "Data Model Design"]],
        ["Backend Build", ["API Endpoints", "Database Integration", "Authentication"]],
        ["Frontend Build", ["UI Screens", "State & API Integration"]],
        ["Testing & Quality", ["Unit Tests with Jest", "API Tests with Supertest"]],
        ["Deployment & Handover", ["Deploying the App", "CI / CD Pipeline", "Documentation & Demo"]],
    ] },
];

// Five sub topics per topic: the same learning arc every time, named for the topic.
const SUB_TOPICS_FOR = (topic) => [
    `Introduction to ${topic}`,
    `${topic}: Core Concepts`,
    `${topic}: Worked Examples`,
    `${topic}: Common Mistakes & Best Practices`,
    `${topic}: Hands-on Practice`,
];

// Level rises through the course: early modules Basic/Easy, late ones Hard.
const levelFor = (moduleIndex, subTopicIndex) => {
    const early = subTopicIndex <= 1
    if (moduleIndex <= 1) return early ? "Basic" : "Easy"
    if (moduleIndex <= 4) return early ? "Easy" : "Medium"
    if (moduleIndex <= 7) return early ? "Medium" : "Hard"
    return "Hard"
}

// Hours per sub topic, using the course's own activity names
// (I Do: Letcure, Learning Resources · We Do: Project Development, Assignment ·
//  You Do: Assesment, Project Trasition). Introductions are taught, the
// middle is practised, the last sub topic is assessed; the capstone leans on
// project work.
const hoursFor = (moduleIndex, subTopicIndex) => {
    const capstone = moduleIndex === 9
    const iDo = subTopicIndex <= 1
        ? [{ type: "Letcure", duration: 1 }, { type: "Learning Resources", duration: 0.5 }]
        : [{ type: "Letcure", duration: 0.5 }]
    const weDo = subTopicIndex >= 2
        ? [{ type: capstone ? "Project Development" : "Assignment", duration: 1 }]
        : []
    const youDo = subTopicIndex === 4
        ? [{ type: capstone ? "Project Trasition" : "Assesment", duration: 1 }]
        : []
    return { iDo, weDo, youDo }
}

async function remove() {
    const q = { courses: COURSE_ID, createdBy: SEED_BY }
    const counts = {
        subTopics: (await SubTopic1.deleteMany(q)).deletedCount,
        topics: (await Topic1.deleteMany(q)).deletedCount,
        subModules: (await SubModule1.deleteMany(q)).deletedCount,
        modules: (await Module1.deleteMany(q)).deletedCount,
        pedagogyViews: (await PedagogyView.deleteMany(q)).deletedCount,
        levelViews: (await LevelView.deleteMany(q)).deletedCount,
    }
    console.log("Removed:", counts)
}

async function add() {
    const course = await CourseStructure.findById(COURSE_ID).lean()
    if (!course) throw new Error(`Course ${COURSE_ID} not found`)
    const existing = await Module1.countDocuments({ courses: COURSE_ID })
    if (existing) throw new Error(`Course already has ${existing} module(s); not adding sample data on top. Use --remove first if they are this script's.`)
    if (await PedagogyView.countDocuments({ courses: COURSE_ID })) throw new Error("Course already has a pedagogy view; refusing to overwrite it.")
    if (await LevelView.countDocuments({ courses: COURSE_ID })) throw new Error("Course already has a level view; refusing to overwrite it.")

    const institution = course.institution
    const base = { institution, courses: COURSE_ID, createdBy: SEED_BY, phase: "" }
    const pedagogies = []
    const levels = []
    const totals = { modules: 0, subModules: 0, topics: 0, subTopics: 0, hours: 0 }

    for (const [mi, mod0] of CURRICULUM.entries()) {
        // One skill for everything in the module (not the course's whole list).
        const testConfiguration = { coreProgram: [], frontend: [], database: [], ...mod0.skill }
        const mod = await Module1.create({ ...base, title: mod0.title, description: `${mod0.title} for full-stack MERN developers.`, index: mi, level: levelFor(mi, 2), testConfiguration })
        totals.modules++
        for (const [si, [smTitle, topics]] of mod0.subModules.entries()) {
            const sm = await SubModule1.create({ ...base, moduleId: mod._id, title: smTitle, description: smTitle, index: si, level: levelFor(mi, 2), testConfiguration })
            totals.subModules++
            for (const [ti, tTitle] of topics.entries()) {
                const t = await Topic1.create({ ...base, moduleId: mod._id, subModuleId: sm._id, title: tTitle, description: tTitle, index: ti, level: levelFor(mi, 2), testConfiguration })
                totals.topics++
                const subTopicDocs = SUB_TOPICS_FOR(tTitle).map((stTitle, sti) => ({
                    ...base, moduleId: mod._id, subModuleId: sm._id, topicId: t._id,
                    title: stTitle, description: stTitle, index: sti, level: levelFor(mi, sti), testConfiguration,
                }))
                const created = await SubTopic1.insertMany(subTopicDocs)
                created.forEach((st, sti) => {
                    totals.subTopics++
                    const ids = { module: [mod._id], subModule: [sm._id], topic: [t._id], subTopic: [st._id] }
                    const hours = hoursFor(mi, sti)
                    totals.hours += [...hours.iDo, ...hours.weDo, ...hours.youDo].reduce((n, x) => n + x.duration, 0)
                    pedagogies.push({ ...ids, ...hours })
                    levels.push({ ...ids, level: levelFor(mi, sti), index: levels.length })
                })
            }
        }
    }

    await PedagogyView.create({ institution, courses: COURSE_ID, pedagogies, createdBy: SEED_BY })
    await LevelView.create({ institution, courses: COURSE_ID, levels, createdBy: SEED_BY })
    console.log(`Added to "${course.courseName}" (${course.courseCode}):`, totals)
}

;(async () => {
    await mongoose.connect(process.env.MONGOURI)
    try {
        if (process.argv.includes("--remove")) await remove()
        else await add()
    } finally {
        await mongoose.disconnect()
    }
})().catch((error) => { console.error("Failed:", error.message); process.exit(1) })
