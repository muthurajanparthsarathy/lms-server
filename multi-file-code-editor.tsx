"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import ExerciseInfoModals, { ExerciseInfoButtons } from './ExerciseInfoModals'
import axios from "axios"
import toast from "react-hot-toast"
import {
  Loader2, CheckCircle, X, ChevronRight, ChevronLeft,
  Terminal as TerminalIcon, FileCode, Award, Clock, Menu, Search,
  ArrowUpDown, X as XIcon, AlertCircle, RefreshCw, Bug,
  Maximize2, Minimize2, FileText, Eye,
} from "lucide-react"
import {
  LANGUAGE_CONFIG, LANGUAGE_ORDER, STARTER_CODE,
  normalizeLanguage, detectLanguageFromFilename,
  type SupportedLanguage,
} from "@/lib/codeLanguages"

// ─── Types ────────────────────────────────────────────────────────────────────
interface FileNode {
  id: string
  filename: string
  content: string
  language: SupportedLanguage | "text"
  path: string
  folderPath: string
  isEntryPoint?: boolean
  lastModified?: Date
}

interface FolderNode {
  id: string
  name: string
  path: string
  parentPath: string
  depth: number
}

interface TerminalLog {
  id: string
  kind: "stdout" | "stderr" | "system" | "success" | "error" | "info"
  message: string
}

interface MultiFileCodeEditorProps {
  exercise?: any
  theme?: "light" | "dark"
  courseId?: string
  nodeId?: string
  nodeName?: string
  nodeType?: string
  subcategory?: string
  category?: string
  onBack?: () => void
  onCloseExercise?: () => void
  onNavigateToBreadcrumb?: (level: "course" | "hierarchy" | "category") => void
  courseName?: string
  hierarchy?: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Decode user ID from a stored JWT token (no external library needed).
const getUserIdFromToken = (): string => {
  try {
    const token =
      localStorage.getItem("smartcliff_token") ||
      localStorage.getItem("token") ||
      ""
    if (!token) return "anonymous"
    const payload = JSON.parse(atob(token.split(".")[1]))
    const id =
      payload.id || payload._id || payload.userId || payload.user_id ||
      payload.sub || payload.email || ""
    // Sanitise: keep only alphanumeric + dash + underscore (safe as a path segment)
    return id ? String(id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) : "anonymous"
  } catch {
    return "anonymous"
  }
}

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"

const formatExerciseTime = (seconds: number | null): string => {
  if (seconds === null) return "--:--"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

const getQuestionHtml = (q: any): string => {
  if (!q) return ""
  if (typeof q.description === "string") return q.description
  if (q.description?.text) return q.description.text
  return ""
}

const mapApiFile = (f: any): FileNode => ({
  id: uid("file"),
  filename: f.filename,
  content: f.content ?? "",
  language: (f.language as SupportedLanguage | "text") || detectLanguageFromFilename(f.filename || ""),
  path: f.path || `/${f.filename}`,
  folderPath: f.folderPath || "/",
  isEntryPoint: !!f.isEntryPoint,
  lastModified: new Date(),
})

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════
export default function MultiFileCodeEditor({
  exercise,
  theme = "light",
  courseId,
  nodeId = "",
  nodeName = "",
  nodeType = "",
  subcategory = "",
  category = "",
  onBack,
  onCloseExercise,
  onNavigateToBreadcrumb,
  courseName,
  hierarchy = [],
}: MultiFileCodeEditorProps) {
  const CODE_SERVER_URL =
    process.env.NEXT_PUBLIC_CODE_SERVER_URL || "https://docker-production-a462.up.railway.app:http://localhost:5533"
    // process.env.NEXT_PUBLIC_CODE_SERVER_URL || "https://docker-file-production-9bf1.up.railway.app"

  // ─── Per-student workspace isolation ─────────────────────────────────────────
  // Each student gets their OWN folder inside the shared workspace so they can
  // never read or overwrite a classmate's files:
  //   /home/coder/project/student-<userId>/   ← this student's VS Code root
  // Derived once on mount; stable for the life of the component.
  const [studentSubdir] = useState<string>(() => {
    const userId = getUserIdFromToken()
    return `student-${userId}`
  })

  // ─── Set Nginx sticky-session cookie BEFORE iframe loads ────────────────────
  // Hits /cs-init once to set the cs_node cookie on the :http://localhost:5533 origin so Nginx
  // routes ALL iframe requests (including WebSocket) to the same code-server.
  useEffect(() => {
    fetch(`${CODE_SERVER_URL}/cs-init?uid=${encodeURIComponent(studentSubdir)}`, {
      redirect: "manual", // don't follow the 302 — we just need the cookie to be set
      mode: "no-cors",
    }).catch(() => {}) // ignore errors — cookie may already be set
  }, [studentSubdir, CODE_SERVER_URL])

  // ─── Workspace-backed file state (source of truth = code-server workspace) ───
  const [files, setFiles] = useState<FileNode[]>([])
  const [folders] = useState<FolderNode[]>([])
  const [questionWidth, setQuestionWidth] = useState(380)

  // ─── Language selection ─────────────────────────────────────────────────────
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>("python")
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [everReady, setEverReady] = useState(false) // iframe mounts once, then stays
  const [seeding, setSeeding] = useState(false)
  const [iframeLoading, setIframeLoading] = useState(true)
  const [isFull, setIsFull] = useState(false)          // VS Code full-screen
  const [showQDrawer, setShowQDrawer] = useState(false) // question drawer while full-screen

  // ─── Question state ─────────────────────────────────────────────────────────
  const questions = useMemo(() => exercise?.questions ?? [], [exercise])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const currentQuestion = questions[currentQuestionIndex] || null

  // ─── Sidebar (problems list) state ──────────────────────────────────────────
  const [showSidebar, setShowSidebar] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterDifficulty, setFilterDifficulty] = useState<"all" | "easy" | "medium" | "hard">("all")
  const [sortBy, setSortBy] = useState<"default" | "difficulty" | "title">("default")
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>("all")
  const [solvedQuestions, setSolvedQuestions] = useState<Set<number>>(new Set())

  // ─── Difficulty map ───────────────────────────────────────────────────────
  const difficultyMap = useMemo<Record<string, { firstIndex: number; count: number }>>(() => {
    const map: Record<string, { firstIndex: number; count: number }> = {}
    questions.forEach((q: any, i: number) => {
      const d = (q?.difficulty || "").toLowerCase()
      if (!d) return
      if (!map[d]) map[d] = { firstIndex: i, count: 0 }
      map[d].count += 1
    })
    return map
  }, [questions])

  const availableDifficulties = useMemo(
    () => (["easy", "medium", "hard"] as const).filter((d) => !!difficultyMap[d]),
    [difficultyMap],
  )

  const jumpToDifficulty = (diff: string) => {
    const entry = difficultyMap[diff]
    if (entry) setCurrentQuestionIndex(entry.firstIndex)
  }

  const getFilteredAndSortedQuestions = useCallback(() => {
    let filtered = questions.map((q: any, i: number) => ({ ...q, _originalIndex: i }))
    if (filterDifficulty !== "all") {
      filtered = filtered.filter((q: any) => (q.difficulty || "").toLowerCase() === filterDifficulty)
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter((q: any) =>
        (q.title || "").toLowerCase().includes(query) ||
        (typeof q.description === "string" && q.description.toLowerCase().includes(query)),
      )
    }
    if (sortBy === "difficulty") {
      const order: Record<string, number> = { easy: 1, medium: 2, hard: 3 }
      filtered.sort((a: any, b: any) => (order[(a.difficulty || "").toLowerCase()] || 4) - (order[(b.difficulty || "").toLowerCase()] || 4))
    } else if (sortBy === "title") {
      filtered.sort((a: any, b: any) => (a.title || "").localeCompare(b.title || ""))
    } else {
      filtered.sort((a: any, b: any) => a._originalIndex - b._originalIndex)
    }
    return filtered
  }, [questions, filterDifficulty, searchQuery, sortBy])

  const cycleSortOption = () => {
    const opts: Array<"default" | "difficulty" | "title"> = ["default", "difficulty", "title"]
    setSortBy(opts[(opts.indexOf(sortBy) + 1) % opts.length])
  }

  const getSortIcon = () => sortBy === "difficulty" ? "🟢🟡🔴" : sortBy === "title" ? "A-Z" : "123"

  const goPrev = () => { if (currentQuestionIndex > 0) setCurrentQuestionIndex((i) => i - 1) }
  const goNext = () => { if (currentQuestionIndex < questions.length - 1) setCurrentQuestionIndex((i) => i + 1) }
  const selectQuestion = (idx: number) => setCurrentQuestionIndex(idx)

  // ─── Submission state ───────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false)
  const [terminalLogs, setTerminalLogs] = useState<TerminalLog[]>([])
  const [lastLog, setLastLog] = useState<TerminalLog | null>(null)
  const isSubmitGuardRef = useRef(false)
  const isSubmitQuestionGuardRef = useRef(false)

  // ─── Modals ─────────────────────────────────────────────────────────────────
  const [showBackConfirm, setShowBackConfirm] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [showOverviewModal, setShowOverviewModal] = useState(false)
  const [pendingNavLevel, setPendingNavLevel] = useState<null | "course" | "hierarchy" | "category">(null)

  // ─── Visualizer (Python Tutor embed) ────────────────────────────────────────
  // State lives here so it's in scope for both `openVisualizer` (declared
  // further down, after `readWorkspaceFiles`) and the modal JSX.
  const [showVisualizer, setShowVisualizer] = useState(false)
  const [visualizerUrl, setVisualizerUrl] = useState<string>("")
  const [visualizerLoading, setVisualizerLoading] = useState(false)

  // ─── Full exercise (re-fetched to get totalMarks etc.) ──────────────────────
  const [fullExercise, setFullExercise] = useState<any>(exercise || null)
  useEffect(() => {
    setFullExercise(exercise || null)
    if (!exercise?._id) return
    const token = localStorage.getItem('smartcliff_token') || localStorage.getItem('token') || ''
    fetch(`http://localhost:5533/exercise/${exercise._id}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        const full = data.data || data.exercise || data
        if (full?._id) setFullExercise({ ...full, questions: exercise.questions ?? full.questions })
      })
      .catch(() => {})
  }, [exercise?._id])
  const exData = fullExercise ?? exercise

  // ─── Available languages (from exercise programming settings) ───────────────
  const availableLanguages = useMemo<SupportedLanguage[]>(() => {
    const raw =
      exData?.programmingSettings?.selectedLanguages ??
      exercise?.programmingSettings?.selectedLanguages ??
      []
    const normalized = (raw as string[])
      .map(normalizeLanguage)
      .filter((l): l is SupportedLanguage => !!l)
    const unique = LANGUAGE_ORDER.filter((l) => normalized.includes(l))
    return unique.length > 0 ? unique : (["python"] as SupportedLanguage[])
  }, [exData, exercise])

  // ─── Timer ──────────────────────────────────────────────────────────────────
  const [exerciseTimeLeft, setExerciseTimeLeft] = useState<number | null>(null)

  // ─── Resize refs ────────────────────────────────────────────────────────────
  const resizing = useRef<null | "question">(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ─── Logging ────────────────────────────────────────────────────────────────
  const addLog = useCallback((kind: TerminalLog["kind"], message: string) => {
    const log = { id: uid("log"), kind, message }
    setLastLog(log)
    setTerminalLogs((prev) => [...prev, log])
  }, [])

  // ─── Auto-submit on time-up (ref keeps the latest files/handler) ─────────────
  const autoSubmitRef = useRef<() => void>(() => {})

  // ─── Timer effect ─────────────────────────────────────────────────────────
  useEffect(() => {
    const totalDuration = exData?.exerciseInformation?.totalDuration
    if (!totalDuration || totalDuration <= 0) { setExerciseTimeLeft(null); return }
    setExerciseTimeLeft(totalDuration * 60)
    const timer = setInterval(() => {
      setExerciseTimeLeft((prev) => {
        if (prev === null) return prev
        if (prev <= 1) {
          clearInterval(timer)
          // Time is up — auto-submit the student's real workspace files & close.
          autoSubmitRef.current()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [exData?.exerciseInformation?.totalDuration])

  // ─── Workspace API helpers ──────────────────────────────────────────────────
  const postWorkspace = useCallback(
    async (payload: any): Promise<FileNode[] | null> => {
      try {
        const res = await fetch("/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Always scope every operation to this student's own subfolder.
          body: JSON.stringify({ subdir: studentSubdir, ...payload }),
        })
        const data = await res.json()
        if (data?.ok && Array.isArray(data.files)) return data.files.map(mapApiFile)
        addLog("error", `Workspace prepare failed: ${data?.error || "unknown"}`)
        return null
      } catch (e: any) {
        addLog("error", `Workspace error: ${e?.message || e}`)
        return null
      }
    },
    [addLog, studentSubdir],
  )

  // Ensure the active language's starter file exists (never wipes existing edits).
  const seedWorkspace = useCallback(
    (langs: SupportedLanguage[], active?: SupportedLanguage) =>
      postWorkspace({ languages: langs, active: active || langs[0] }),
    [postWorkspace],
  )

  // Restore a previous submission's exact files into the workspace.
  const restoreWorkspace = useCallback(
    (langs: SupportedLanguage[], restoreFiles: any[], active?: SupportedLanguage) =>
      postWorkspace({ languages: langs, active: active || langs[0], files: restoreFiles }),
    [postWorkspace],
  )

  // Read the REAL files the student edited in code-server (from disk).
  const readWorkspaceFiles = useCallback(async (): Promise<FileNode[]> => {
    try {
      const res = await fetch(
        `/api/workspace?subdir=${encodeURIComponent(studentSubdir)}`,
        { cache: "no-store" },
      )
      const data = await res.json()
      if (data?.ok && Array.isArray(data.files) && data.files.length > 0) {
        return data.files.map(mapApiFile)
      }
    } catch { /* fall through */ }
    return files
  }, [files, studentSubdir])

  // Visualizer (Python Tutor embed) — opens after `readWorkspaceFiles` is in
  // scope, otherwise we'd hit a temporal-dead-zone error on initial render.
  // Reads the LIVE workspace file content, encodes it into a Python Tutor
  // iframe URL, and shows the step-through visualizer in a centred overlay.
  // Supports the languages Python Tutor supports (py / js / java / c / cpp);
  // anything else falls back to Python and warns via toast.
  const openVisualizer = useCallback(async () => {
    if (seeding) return
    setVisualizerLoading(true)
    setShowVisualizer(true)
    try {
      const realFiles = await readWorkspaceFiles()
      const langFiles = realFiles.filter((f) => detectLanguageFromFilename(f.filename) === selectedLanguage)
      const codeFile = (langFiles[0] || realFiles[0])
      const code = codeFile?.content || ""
      if (!code.trim()) {
        toast("Write some code first, then click Visualize.", { icon: "ℹ️" })
        setShowVisualizer(false)
        return
      }
      const ptLangMap: Record<string, string> = {
        python: "311",
        javascript: "js",
        java: "java",
        c: "c",
        cpp: "cpp",
      }
      const py = ptLangMap[selectedLanguage] || "311"
      if (!ptLangMap[selectedLanguage]) {
        toast(`Visualizer doesn't support ${selectedLanguage} — showing Python view.`, { icon: "ℹ️" })
      }
      const params = new URLSearchParams({
        code,
        codeDivHeight: "400",
        codeDivWidth: "350",
        cumulative: "false",
        curInstr: "0",
        heapPrimitives: "nevernest",
        origin: "opt-frontend.js",
        py,
        rawInputLstJSON: "[]",
        textReferences: "false",
      })
      setVisualizerUrl(`https://pythontutor.com/iframe-embed.html#${params.toString()}`)
    } catch (e: any) {
      toast.error(`Could not open Visualizer: ${e?.message || e}`)
      setShowVisualizer(false)
    } finally {
      setVisualizerLoading(false)
    }
  }, [seeding, readWorkspaceFiles, selectedLanguage])

  // Fetch this question's last saved submission from the LMS backend.
  const fetchPreviousSubmission = useCallback(async (): Promise<{ files: any[]; language: string } | null> => {
    const exerciseId = exercise?._id
    const questionId = currentQuestion?._id
    if (!exerciseId || !questionId || !courseId || !category) return null
    try {
      const token = localStorage.getItem("smartcliff_token") || localStorage.getItem("token") || ""
      const res = await fetch(
        `http://localhost:5533/courses/answers/previous-submission?courseId=${courseId}&exerciseId=${exerciseId}&questionId=${questionId}&category=${category}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) return null
      const data = await res.json()
      if (!data?.success || !data?.data?.files?.length) return null
      return { files: data.data.files, language: data.data.selectedProgrammingLanguage || "" }
    } catch { return null }
  }, [exercise?._id, currentQuestion?._id, courseId, category])

  // ─── Prepare the workspace on exercise / question / language change ──────────
  // Restores this question's last submission if one exists; otherwise seeds a
  // starter for the primary language. Never blindly wipes the student's edits.
  useEffect(() => {
    let cancelled = false
    const primary = availableLanguages[0] || "python"
    setWorkspaceReady(false)
    setSeeding(true)
    setSelectedLanguage((prev) => (availableLanguages.includes(prev) ? prev : primary))

    ;(async () => {
      const prev = await fetchPreviousSubmission()
      let result: FileNode[] | null = null

      if (prev && prev.files.length > 0) {
        const savedLang = normalizeLanguage(prev.language)
        const entryName = (prev.files.find((f: any) => f.isEntryPoint) || prev.files[0])?.filename || ""
        const entryLang = detectLanguageFromFilename(entryName)
        const lang: SupportedLanguage =
          savedLang && availableLanguages.includes(savedLang) ? savedLang
          : entryLang !== "text" && availableLanguages.includes(entryLang) ? entryLang
          : primary
        result = await restoreWorkspace(availableLanguages, prev.files, lang)
        if (!cancelled && result) {
          setSelectedLanguage(lang)
          addLog("system", `Restored your last submission (${prev.files.length} file${prev.files.length !== 1 ? "s" : ""}).`)
        }
      } else {
        result = await seedWorkspace(availableLanguages, primary)
      }

      if (cancelled) return
      if (result) {
        setFiles(result)
      } else {
        const cfg = LANGUAGE_CONFIG[primary]
        setFiles([{
          id: uid("file"), filename: cfg.filename, content: STARTER_CODE[primary],
          language: primary, path: `/${cfg.filename}`, folderPath: "/",
          isEntryPoint: true, lastModified: new Date(),
        }])
      }
      setSeeding(false)
      setWorkspaceReady(true)
      setEverReady(true)
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise?._id, currentQuestion?._id, availableLanguages.join(",")])

  // ─── Switch language: reset the workspace so ONLY this language's file exists ─
  const switchLanguage = useCallback(async (lang: SupportedLanguage) => {
    if (lang === selectedLanguage || seeding) return
    setSelectedLanguage(lang)
    setSeeding(true)
    const cfg = LANGUAGE_CONFIG[lang]
    // Exclusive: clear the workspace and seed only this language's starter file.
    const seeded = await restoreWorkspace(
      [lang],
      [{ path: `/${cfg.filename}`, content: STARTER_CODE[lang] }],
      lang,
    )
    if (seeded) setFiles(seeded)
    setSeeding(false)
    addLog("info", `Switched to ${cfg.label} — workspace now has only ${cfg.filename}.`)
  }, [selectedLanguage, seeding, restoreWorkspace, addLog])

  const refreshFiles = useCallback(async () => {
    const fresh = await readWorkspaceFiles()
    setFiles(fresh)
    addLog("info", `Loaded ${fresh.length} file(s) from the editor workspace.`)
  }, [readWorkspaceFiles, addLog])

  // ─── Create a new file from the LMS toolbar (always works, even in the iframe) ─
  // Enforces the selected language's extension so students can only add files of
  // the language they picked. The file is written to disk; code-server's file
  // watcher shows it in the explorer within ~1s.
  const createNewFile = useCallback(async () => {
    if (seeding) return
    const cfg = LANGUAGE_CONFIG[selectedLanguage]
    const ext = cfg.ext
    const raw = window.prompt(
      `New ${cfg.label} file name (only .${ext} allowed):`,
      `solution.${ext}`,
    )
    if (raw == null) return // cancelled
    let name = raw.trim().replace(/^\/+/, "").replace(/\.\.[/\\]/g, "")
    if (!name) return
    // Force the correct extension for the selected language.
    const hasExt = name.includes(".")
    const currentExt = hasExt ? name.split(".").pop()!.toLowerCase() : ""
    if (currentExt !== ext) {
      const base = hasExt ? name.slice(0, name.lastIndexOf(".")) : name
      name = `${base}.${ext}`
      toast(`Saved as ${name} — only .${ext} files are allowed for ${cfg.label}.`, { icon: "ℹ️" })
    }
    const result = await postWorkspace({
      add: true,
      languages: [selectedLanguage],
      files: [{ path: `/${name}`, content: "" }],
    })
    if (result) {
      setFiles(result)
      toast.success(`Created ${name}`)
      addLog("success", `Created ${name} — open it from the Explorer on the right.`)
    }
  }, [seeding, selectedLanguage, postWorkspace, addLog])

  // ─── Enforce single language: poll the workspace and remove any file that is a
  // different programming language than the selected one, then toast the student. ─
  useEffect(() => {
    if (!workspaceReady) return
    let busy = false
    const id = setInterval(async () => {
      if (busy || seeding) return
      busy = true
      try {
        const res = await fetch("/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdir: studentSubdir, prune: selectedLanguage }),
        })
        const data = await res.json()
        if (data?.ok && Array.isArray(data.removed) && data.removed.length > 0) {
          const label = LANGUAGE_CONFIG[selectedLanguage]?.label || selectedLanguage
          toast.error(
            `Only ${label} files are allowed here. Removed: ${data.removed.join(", ")}`,
            { duration: 4000 },
          )
          if (Array.isArray(data.files)) setFiles(data.files.map(mapApiFile))
        }
      } catch { /* ignore poll errors */ }
      finally { busy = false }
    }, 3000)
    return () => clearInterval(id)
  }, [workspaceReady, selectedLanguage, seeding, studentSubdir])

  // ═════════════════════════════════════════════════════════════════════════════
  // Submit — always read the REAL files from the workspace first
  // ═════════════════════════════════════════════════════════════════════════════
  const postSubmission = async (isTestSubmission: boolean): Promise<{ ok: boolean; message?: string }> => {
    const exerciseId = exercise?._id
    const questionId = currentQuestion?._id
    if (!exerciseId || !questionId || !courseId) {
      return { ok: false, message: "Missing exercise context." }
    }
    // Give code-server's auto-save (700ms) a moment to flush the latest edits to
    // disk before we read them, so the submission captures the newest content.
    await new Promise((r) => setTimeout(r, 900))
    const realFiles = await readWorkspaceFiles()
    setFiles(realFiles)
    // Only submit files that match the selected language (e.g. .py when Python is
    // selected). Falls back to all files if nothing matches, so we never send empty.
    const langFiles = realFiles.filter((f) => detectLanguageFromFilename(f.filename) === selectedLanguage)
    const submitFiles = langFiles.length > 0 ? langFiles : realFiles
    const token = localStorage.getItem("smartcliff_token") || localStorage.getItem("token") || ""
    const payload = {
      courseId, exerciseId, questionId,
      questionTitle: currentQuestion?.title || `Question ${currentQuestionIndex + 1}`,
      exerciseName: exercise?.exerciseInformation?.exerciseName,
      category, subcategory,
      selectedProgrammingLanguage: selectedLanguage,
      nodeId, nodeName, nodeType,
      files: submitFiles.map((f) => ({
        id: f.id, filename: f.filename, content: f.content, language: f.language,
        path: f.path, folderPath: f.folderPath, isEntryPoint: !!f.isEntryPoint,
        lastModified: f.lastModified || new Date(),
      })),
      folders: [],
      status: "submitted",
      score: 0,
      isTestSubmission,
    }
    const res = await axios.post(
      "http://localhost:5533/courses/answers/submit-multiple-files",
      payload,
      { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } },
    )
    return res.data?.success ? { ok: true } : { ok: false, message: res.data?.message || "unknown" }
  }

  const submitQuestion = async () => {
    if (isSubmitQuestionGuardRef.current) return
    isSubmitQuestionGuardRef.current = true
    setIsSubmittingQuestion(true)
    try {
      const result = await postSubmission(false)
      if (result.ok) {
        addLog("success", `Question ${currentQuestionIndex + 1} saved.`)
        setSolvedQuestions((prev) => new Set(prev).add(currentQuestionIndex))
      } else {
        addLog("error", `Save failed: ${result.message}`)
      }
    } catch (e: any) {
      addLog("error", `Save error: ${e?.message || e}`)
    } finally {
      setIsSubmittingQuestion(false)
      isSubmitQuestionGuardRef.current = false
    }
  }

  const submitExercise = async (opts?: { auto?: boolean }) => {
    if (isSubmitGuardRef.current) return
    isSubmitGuardRef.current = true
    setIsSubmitting(true)
    try {
      const result = await postSubmission(true)
      if (result.ok) {
        addLog("success", `Exercise submitted.`)
        setSolvedQuestions((prev) => new Set(prev).add(currentQuestionIndex))
        if (exercise?._id) localStorage.removeItem("ex_in_progress_" + exercise._id)
        {
          const exName = exercise?.exerciseInformation?.exerciseName || "Exercise"
          toast.success(opts?.auto ? `Time's up! "${exName}" submitted successfully.` : `"${exName}" submitted successfully`)
        }
        // Close promptly and return to the exercise list (inline: the list is
        // already underneath with the same node + tab + activity selected). The
        // react-hot-toast success above is rendered by the page-level Toaster, so
        // it survives this overlay unmounting and stays visible on the list.
        setTimeout(() => { if (onCloseExercise) onCloseExercise(); else if (onBack) onBack() }, 700)
      } else {
        addLog("error", `Submission failed: ${result.message}`)
        if (opts?.auto) toast.error("Auto-submit failed. Please submit manually.")
        isSubmitGuardRef.current = false
      }
    } catch (e: any) {
      addLog("error", `Submission error: ${e?.message || e}`)
      if (opts?.auto) toast.error("Auto-submit failed. Please submit manually.")
      isSubmitGuardRef.current = false
    } finally {
      setIsSubmitting(false)
    }
  }

  // Keep the time-up handler current so it submits the latest workspace state.
  useEffect(() => {
    autoSubmitRef.current = () => {
      if (isSubmitGuardRef.current || isSubmitting) return
      submitExercise({ auto: true })
    }
  })

  // ─── Resize handler ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!resizing.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      if (resizing.current === "question") {
        const w = Math.max(220, Math.min(640, e.clientX - rect.left))
        setQuestionWidth(w)
      }
    }
    const handleUp = () => { resizing.current = null }
    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleUp)
    return () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp) }
  }, [])

  // ─── code-server iframe URL — opens directly at student's own folder ─────────
  // Points VS Code straight to the student's subfolder so the explorer shows
  // their files (not the root workspace). The cs_node cookie for Nginx sticky
  // routing is set via a hidden prefetch request before the iframe mounts.
  const folderPath = `/home/coder/project/${studentSubdir}`
  const iframeSrc = `${CODE_SERVER_URL}/?folder=${encodeURIComponent(folderPath)}`

  const copyRunCmd = (cmd: string) => {
    try { navigator.clipboard?.writeText(cmd); addLog("info", `Copied: ${cmd}`) }
    catch { addLog("info", cmd) }
  }

  // Question Prev/Next nav (reused in the docked panel header and the full-screen drawer)
  const questionNav = questions.length > 1 ? (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button onClick={goPrev} disabled={currentQuestionIndex === 0} className="px-2 h-6 flex items-center justify-center gap-0.5 border rounded text-[11px] font-medium transition-colors border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 disabled:text-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed" title="Previous Problem">
        <ChevronLeft className="w-3 h-3" /> Prev
      </button>
      <span className="text-[11px] font-semibold min-w-[34px] text-center text-emerald-600">{currentQuestionIndex + 1}/{questions.length}</span>
      <button onClick={goNext} disabled={currentQuestionIndex === questions.length - 1} className="px-2 h-6 flex items-center justify-center gap-0.5 border rounded text-[11px] font-medium transition-colors border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 disabled:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed" title="Next Problem">
        Next <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  ) : (
    <span className="text-[10px] text-gray-500 font-mono flex-shrink-0">Q {currentQuestionIndex + 1}/{questions.length || 1}</span>
  )

  // Question body (reused in the docked panel and the full-screen drawer)
  const questionContent = (
    <>
      <h2 className="text-sm font-bold mb-2 text-gray-900">{currentQuestion?.title || exercise?.exerciseInformation?.exerciseName || "Exercise"}</h2>
      {(currentQuestion?.difficulty || (exData?.isGraded !== false && (currentQuestion?.score ?? currentQuestion?.points) != null)) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {currentQuestion?.difficulty && (
            <span className={`inline-block text-[10px] px-2 py-0.5 rounded font-semibold ${currentQuestion.difficulty === "easy" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : currentQuestion.difficulty === "medium" ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
              {currentQuestion.difficulty.toUpperCase()}
            </span>
          )}
          {exData?.isGraded !== false && (() => {
            const qMark = currentQuestion?.score ?? currentQuestion?.points ?? null
            if (qMark == null) return null
            return <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, background: "#dcfce7", color: "#15803d", fontWeight: 700, border: "1px solid #bbf7d0", whiteSpace: "nowrap" }}>{qMark} {qMark === 1 ? "mark" : "marks"}</span>
          })()}
        </div>
      )}
      <div className="prose prose-sm max-w-none text-gray-800" dangerouslySetInnerHTML={{ __html: getQuestionHtml(currentQuestion) || exercise?.exerciseInformation?.description || "<p>Solve the problem using the VS Code editor on the right.</p>" }} />
      {currentQuestion?.sampleInput && (
        <div className="mt-4"><div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1 font-semibold">Sample Input</div><pre className="bg-gray-50 border border-gray-200 p-2 rounded text-[11px] overflow-x-auto">{currentQuestion.sampleInput}</pre></div>
      )}
      {currentQuestion?.sampleOutput && (
        <div className="mt-3"><div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1 font-semibold">Sample Output</div><pre className="bg-gray-50 border border-gray-200 p-2 rounded text-[11px] overflow-x-auto">{currentQuestion.sampleOutput}</pre></div>
      )}
      {currentQuestion?.constraints?.length > 0 && (
        <div className="mt-3"><div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1 font-semibold">Constraints</div><ul className="list-disc pl-4 text-[11px]">{currentQuestion.constraints.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></div>
      )}
    </>
  )

  // ═════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════════
  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full w-full"
      style={{ background: "#fff", color: "#111827", fontFamily: FONT, userSelect: resizing.current ? "none" : "auto" }}
    >
      {/* ═══ TOP CHROME (hidden in full-screen) ═══ */}
      {exercise && !isFull && (
        <div style={{ flexShrink: 0, borderBottom: `1px solid #e5e7eb` }}>
          {/* Row 1 — back button + left separator intentionally removed.
              The only exit is Submit Exercise, which prevents accidental data loss. */}
          <div style={{ display: "flex", alignItems: "center", padding: "6px 12px", gap: 8, borderBottom: `1px solid #f0f0f0`, background: "#ffffff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <button onClick={() => setPendingNavLevel("course")} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 500, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>
                {courseName || "Course"}
              </button>
              {hierarchy.map((seg, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <ChevronRight style={{ width: 12, height: 12, color: "#c0c4cc", flexShrink: 0 }} />
                  <button onClick={() => setPendingNavLevel("hierarchy")} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 500, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>
                    {seg}
                  </button>
                </span>
              ))}
              {category && (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <ChevronRight style={{ width: 12, height: 12, color: "#c0c4cc", flexShrink: 0 }} />
                  <button onClick={() => setPendingNavLevel("category")} style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 500, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>
                    {category === "We_Do" ? "We Do" : category === "I_Do" ? "I Do" : category === "You_Do" ? "You Do" : category}
                  </button>
                </span>
              )}
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <ChevronRight style={{ width: 12, height: 12, color: "#c0c4cc", flexShrink: 0 }} />
                <span style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {exercise?.exerciseInformation?.exerciseName || "Exercise"}
                </span>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 8 }}>
              <button onClick={submitExercise} disabled={isSubmitting}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, border: "none", background: isSubmitting ? "#6b7280" : "#10b981", color: "white", fontSize: 13, fontWeight: 500, cursor: isSubmitting ? "not-allowed" : "pointer", transition: "all 0.2s ease", opacity: isSubmitting ? 0.7 : 1 }}>
                {isSubmitting ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <CheckCircle style={{ width: 14, height: 14 }} />}
                Submit Exercise
              </button>
              {/* Red X close button removed — Submit Exercise is the only exit. */}
            </div>
          </div>

          {/* Row 2 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px", background: "#ffffff", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {availableDifficulties.length > 0 && (
                <>
                  <span style={{ fontSize: 11, color: "#6b7280", fontFamily: FONT, fontWeight: 400 }}>Difficulty</span>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <select value={selectedDifficulty}
                      onChange={(e) => { setSelectedDifficulty(e.target.value); if (e.target.value !== "all") jumpToDifficulty(e.target.value) }}
                      style={{ appearance: "none", WebkitAppearance: "none", height: 28, padding: "0 28px 0 10px", borderRadius: 99,
                        border: `1px solid ${selectedDifficulty === "easy" ? "#16a34a" : selectedDifficulty === "medium" ? "#d97706" : selectedDifficulty === "hard" ? "#dc2626" : "#d1d5db"}`,
                        background: "#ffffff", color: selectedDifficulty === "easy" ? "#16a34a" : selectedDifficulty === "medium" ? "#d97706" : selectedDifficulty === "hard" ? "#dc2626" : "#6b7280",
                        fontFamily: FONT, fontSize: 12, fontWeight: 500, cursor: "pointer", outline: "none" }}>
                      <option value="all">All difficulties</option>
                      {availableDifficulties.map((diff) => (
                        <option key={diff} value={diff}>{diff.charAt(0).toUpperCase() + diff.slice(1)} ({difficultyMap[diff].count})</option>
                      ))}
                    </select>
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                      style={{ position: "absolute", right: 9, pointerEvents: "none", width: 12, height: 12,
                        color: selectedDifficulty === "easy" ? "#16a34a" : selectedDifficulty === "medium" ? "#d97706" : selectedDifficulty === "hard" ? "#dc2626" : "#6b7280" }}>
                      <path d="M2 4l4 4 4-4" />
                    </svg>
                  </div>
                </>
              )}
              {exData?.isGraded !== false && (() => {
                const _ss = exData?.questionConfiguration?.programmingQuestionConfiguration?.scoreSettings
                const _progCalc = _ss
                  ? _ss.scoreType === 'evenMarks' && _ss.evenMarks
                    ? _ss.evenMarks * (questions.length || 1)
                    : (['easy', 'medium', 'hard'] as const).reduce((s, d) => s + ((_ss.levelScoringConfiguration as any)?.[d]?.totalMarks || 0), 0)
                  : 0
                const tm = exData?.exerciseInformation?.totalMarksProgramming || exData?.exerciseInformation?.totalMarks || exData?.exerciseInformation?.totalPoints || exData?.questionConfiguration?.mcqQuestionConfiguration?.mcqTotalMarks || _progCalc || 0
                return (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: '#dcfce7', color: '#15803d', display: 'flex', alignItems: 'center', gap: 4, fontFamily: FONT, whiteSpace: 'nowrap' }}>
                    <Award style={{ width: 12, height: 12 }} /> Total marks: {tm}
                  </span>
                )
              })()}
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 10px", borderRadius: 99, background: "#eff6ff" }}>
                <FileCode style={{ width: 12, height: 12, color: "#2563eb" }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "#2563eb" }}>{files.length} file{files.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
            <ExerciseInfoButtons onDetailsClick={() => setShowDetailsModal(true)} onOverviewClick={() => setShowOverviewModal(true)} isGraded={exData?.isGraded !== false} detailsActive={showDetailsModal} overviewActive={showOverviewModal} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {exerciseTimeLeft !== null && (exData?.exerciseInformation?.totalDuration || 0) > 0 && (() => {
                const totalSecs = (exData?.exerciseInformation?.totalDuration || 0) * 60
                const pct = totalSecs > 0 ? Math.max(0, (exerciseTimeLeft / totalSecs) * 100) : 0
                const isDanger = exerciseTimeLeft < 60
                const isWarning = exerciseTimeLeft < 300 && !isDanger
                const tcol = isDanger ? '#ef4444' : isWarning ? '#f59e0b' : '#F27757'
                return (
                  <div style={{ minWidth: 130 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock style={{ width: 12, height: 12, color: tcol }} />
                        <span style={{ fontSize: 11, color: '#9b9bae', fontWeight: 600, fontFamily: FONT }}>Time Left</span>
                      </div>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14, fontWeight: 800, color: tcol, animation: isDanger ? 'pulse 1s ease-in-out infinite' : 'none' }}>
                        {formatExerciseTime(exerciseTimeLeft)}
                      </span>
                    </div>
                    <div style={{ height: 4, borderRadius: 99, background: '#f4f4f7', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: tcol, borderRadius: 99, transition: 'width 1s linear' }} />
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>

        </div>
      )}

      {/* ═══ MAIN BODY ═══ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Problems Sidebar */}
        {showSidebar && (
          <div className="w-80 border-r overflow-hidden flex flex-col flex-shrink-0" style={{ borderColor: "#e5e7eb", background: "#fff" }}>
            <div className="p-3 border-b" style={{ borderColor: "#e5e7eb" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Problems ({getFilteredAndSortedQuestions().length}/{questions.length})</h3>
                <button onClick={() => setShowSearch(!showSearch)} className={`p-1 ml-1 rounded transition-colors ${showSearch ? "bg-blue-500" : "hover:bg-gray-100 text-gray-600"}`}>
                  {showSearch ? <XIcon className="w-3.5 h-3.5 text-white" /> : <Search className="w-3.5 h-3.5" />}
                </button>
              </div>
              {showSearch && (
                <div className="relative mb-3">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input type="text" placeholder="Search problems..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-8 pr-6 py-1.5 text-xs border rounded focus:ring-1 focus:ring-blue-500 focus:outline-none border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500" autoFocus />
                  {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-1 top-1/2 transform -translate-y-1/2"><XIcon className="w-3.5 h-3.5 text-gray-400" /></button>}
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <select value={filterDifficulty} onChange={(e) => setFilterDifficulty(e.target.value as any)} className="w-full text-xs border rounded px-2 py-1.5 bg-white border-gray-300 text-gray-900">
                    <option value="all">All Difficulties</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <button onClick={cycleSortOption} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded transition-colors border-gray-300 hover:bg-gray-100" title="Change sort">
                  <ArrowUpDown className="w-3.5 h-3.5 text-gray-600" />
                  <span className="font-medium text-gray-600">{sortBy === "default" ? "Default" : sortBy === "difficulty" ? "Difficulty" : "Title"}</span>
                </button>
              </div>
              <div className="mt-2 text-[10px] text-gray-400 flex items-center justify-between">
                <span>{filterDifficulty !== "all" ? `Filtered: ${filterDifficulty.charAt(0).toUpperCase() + filterDifficulty.slice(1)}` : "Showing all difficulties"}</span>
                <span className="flex items-center gap-1"><span>Sort:</span><span className="px-1.5 py-0.5 rounded bg-gray-100">{getSortIcon()}</span></span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {getFilteredAndSortedQuestions().length === 0 ? (
                <div className="p-4 text-center"><div className="text-sm text-gray-400">No problems found{filterDifficulty !== "all" && ` for "${filterDifficulty}" difficulty`}{searchQuery && ` matching "${searchQuery}"`}</div></div>
              ) : (
                getFilteredAndSortedQuestions().map((q: any) => {
                  const originalIndex = q._originalIndex
                  const isActive = currentQuestionIndex === originalIndex
                  const diff = (q.difficulty || "").toLowerCase()
                  const isGraded = exercise?.isGraded !== false
                  const qMarks = q?.score ?? q?.points ?? null
                  return (
                    <button key={originalIndex} onClick={() => selectQuestion(originalIndex)} className={`w-full p-3 text-left transition-colors border-b border-gray-100 ${isActive ? "bg-blue-50 border-l-2 border-l-blue-500" : "hover:bg-gray-50"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium truncate flex-1 text-gray-900">{originalIndex + 1}. {q.title || `Question ${originalIndex + 1}`}</div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                          {diff && <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${diff === "easy" ? "bg-green-100 text-green-800" : diff === "medium" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}`}>{diff.charAt(0).toUpperCase() + diff.slice(1)}</span>}
                          {isGraded && qMarks != null && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99, background: "#dcfce7", color: "#15803d", fontWeight: 600, whiteSpace: "nowrap" }}>{qMarks} {qMarks === 1 ? "mark" : "marks"}</span>}
                          {solvedQuestions.has(originalIndex) && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99, background: "#dcfce7", color: "#166534", fontWeight: 600, border: "1px solid #86efac", whiteSpace: "nowrap" }}>Submitted</span>}
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* Question Panel (LEFT) — hidden in full-screen */}
        {!isFull && (
          <>
            <div className="flex flex-col flex-shrink-0 overflow-hidden border-r" style={{ width: questionWidth, background: "#fff", borderColor: "#e5e7eb" }}>
              <div className="px-3 py-2 border-b flex items-center justify-between gap-2" style={{ borderColor: "#e5e7eb", background: "#ffffff" }}>
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => setShowSidebar(!showSidebar)}
                    className="flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-gray-100 text-gray-700 flex-shrink-0"
                    title={showSidebar ? "Hide problems list" : "Show problems list"}
                  >
                    {showSidebar ? <ChevronLeft className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                  </button>
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Problem</span>
                </div>
                {questionNav}
              </div>
              <div className="flex-1 overflow-y-auto p-4 text-xs leading-relaxed text-gray-800">
                {questionContent}
              </div>
            </div>

            {/* Question resize handle */}
            <div onMouseDown={() => { resizing.current = "question" }} className="w-1 cursor-col-resize hover:bg-blue-400 transition-colors flex-shrink-0" style={{ background: "#e5e7eb" }} />
          </>
        )}

        {/* RIGHT: Language selector + code-server iframe */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ background: "#ffffff" }}>
          {/* Language selector (dropdown) + actions — WHITE toolbar */}
          <div className="flex items-center justify-between flex-shrink-0 px-3" style={{ background: "#ffffff", borderBottom: "1px solid #e5e7eb", minHeight: 38 }}>
            <div className="flex items-center gap-2">
              {isFull && (
                <button
                  onClick={() => setShowQDrawer((v) => !v)}
                  title={showQDrawer ? "Hide question" : "Show question (Prev / Next inside)"}
                  className="flex items-center gap-1 h-6 px-2 rounded text-[11px] font-semibold transition-colors"
                  style={{ background: showQDrawer ? "#2563eb" : "#f3f4f6", color: showQDrawer ? "#fff" : "#374151", border: showQDrawer ? "none" : "1px solid #e5e7eb" }}
                >
                  <FileText size={13} /> Question
                </button>
              )}
              <span className="text-[11px] text-gray-600">Language</span>
              <div className="relative flex items-center">
                <select
                  value={selectedLanguage}
                  disabled={seeding}
                  onChange={(e) => switchLanguage(e.target.value as SupportedLanguage)}
                  title="Pick the language — the workspace will hold only that language's file"
                  style={{
                    appearance: "none", WebkitAppearance: "none",
                    height: 26, padding: "0 26px 0 10px", borderRadius: 6,
                    border: `1px solid ${LANGUAGE_CONFIG[selectedLanguage]?.color || "#d1d5db"}`,
                    background: "#ffffff", color: "#111827",
                    fontSize: 12, fontWeight: 600, fontFamily: "ui-monospace, monospace",
                    cursor: seeding ? "not-allowed" : "pointer", outline: "none",
                    opacity: seeding ? 0.6 : 1,
                  }}
                >
                  {availableLanguages.map((lang) => (
                    <option key={lang} value={lang} style={{ background: "#ffffff", color: "#111827" }}>
                      {LANGUAGE_CONFIG[lang].label}  ({LANGUAGE_CONFIG[lang].filename})
                    </option>
                  ))}
                </select>
                <svg viewBox="0 0 12 12" fill="none" stroke={LANGUAGE_CONFIG[selectedLanguage]?.color || "#6b7280"} strokeWidth="1.5"
                  style={{ position: "absolute", right: 8, pointerEvents: "none", width: 12, height: 12 }}>
                  <path d="M2 4l4 4 4-4" />
                </svg>
              </div>
              <span className="text-[10px] text-gray-500 font-mono hidden md:inline">
                only {LANGUAGE_CONFIG[selectedLanguage]?.filename} in this workspace
              </span>
            </div>
            <div className="flex items-center gap-3 pr-3 flex-shrink-0">
              {seeding && <span className="flex items-center gap-1 text-[11px] text-gray-600"><Loader2 size={11} className="animate-spin" /> preparing…</span>}
              <button onClick={refreshFiles} title="Reload files from the editor (sync before submit)" className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-900">
                <RefreshCw size={11} /> Sync
              </button>
              {/* Visualizer — opens Python Tutor step-through view of the current code */}
              <button onClick={openVisualizer} disabled={seeding || visualizerLoading} title="Step through your code visually (Python Tutor)"
                style={{ display: "flex", alignItems: "center", gap: 5, height: 26, padding: "0 12px", fontSize: 11, fontFamily: FONT, fontWeight: 600, borderRadius: 6, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", cursor: (seeding || visualizerLoading) ? "not-allowed" : "pointer", opacity: (seeding || visualizerLoading) ? 0.6 : 1 }}>
                {visualizerLoading ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Eye style={{ width: 12, height: 12 }} />}
                Visualizer
              </button>
              {exercise && (
                <button onClick={submitQuestion} disabled={isSubmittingQuestion || isSubmitting} title="Save this question (reads your real files from the editor)"
                  style={{ display: "flex", alignItems: "center", gap: 5, height: 26, padding: "0 12px", fontSize: 11, fontFamily: FONT, fontWeight: 600, borderRadius: 6, border: "none", background: (isSubmittingQuestion || isSubmitting) ? "#9ca3af" : "#22c55e", color: "#fff", cursor: (isSubmittingQuestion || isSubmitting) ? "not-allowed" : "pointer", opacity: (isSubmittingQuestion || isSubmitting) ? 0.7 : 1 }}>
                  {isSubmittingQuestion ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <CheckCircle style={{ width: 12, height: 12 }} />}
                  Submit Question
                </button>
              )}
              <button
                onClick={() => { setShowQDrawer(false); setIsFull((v) => !v) }}
                title={isFull ? "Exit full screen" : "Full screen editor"}
                className="flex items-center justify-center w-7 h-7 rounded text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                {isFull ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>

          {/* Status bar — light backgrounds matching the white toolbar above */}
          {lastLog && (
            <div className="flex items-center gap-2 px-3 py-1 text-xs flex-shrink-0"
              style={{
                background: lastLog.kind === "error" ? "#fef2f2" : lastLog.kind === "success" ? "#f0fdf4" : "#eff6ff",
                color: lastLog.kind === "error" ? "#b91c1c" : lastLog.kind === "success" ? "#15803d" : "#1d4ed8",
                borderBottom: "1px solid #e5e7eb",
              }}>
              {lastLog.kind === "error" ? <AlertCircle size={12} /> : lastLog.kind === "success" ? <CheckCircle size={12} /> : <TerminalIcon size={12} />}
              <span className="truncate flex-1 font-mono">{lastLog.message}</span>
              <button onClick={() => setLastLog(null)} className="opacity-60 hover:opacity-100"><X size={12} /></button>
            </div>
          )}

          {/* code-server iframe */}
          <div className="flex-1 relative" style={{ minHeight: 0 }}>
            {/* Full-screen question drawer (slides over the editor's left edge) */}
            {isFull && showQDrawer && (
              <div
                className="absolute top-0 left-0 bottom-0 z-20 flex flex-col bg-white shadow-2xl"
                style={{ width: Math.min(questionWidth, 460), borderRight: "1px solid #e5e7eb" }}
              >
                <div className="px-3 py-2 border-b flex items-center justify-between gap-2" style={{ borderColor: "#e5e7eb", background: "#ffffff" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => setShowQDrawer(false)}
                      className="flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100 text-gray-700 flex-shrink-0"
                      title="Hide question"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Problem</span>
                  </div>
                  {questionNav}
                </div>

                <div className="flex-1 overflow-y-auto p-4 text-xs leading-relaxed text-gray-800">
                  {questionContent}
                </div>
              </div>
            )}
            {(!workspaceReady || iframeLoading) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10" style={{ background: "#ffffff" }}>
                <Loader2 className="w-7 h-7 animate-spin" style={{ color: LANGUAGE_CONFIG[selectedLanguage]?.color }} />
                <div className="text-sm text-gray-700">{!workspaceReady ? "Preparing your workspace…" : "Loading VS Code…"}</div>
                <div className="text-[11px] text-gray-400 font-mono">{iframeSrc}</div>
              </div>
            )}
            {everReady && (
              <iframe
                src={iframeSrc}
                title="VS Code (code-server)"
                className="w-full h-full"
                style={{ border: "none", display: "block" }}
                allow="clipboard-read; clipboard-write"
                onLoad={() => setIframeLoading(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* ═══ MODALS ═══ */}
      {showBackConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", width: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", border: "1px solid #e5e7eb" }}>
            <p style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 8 }}>Leave Exercise?</p>
            <p style={{ fontFamily: FONT, fontSize: 13, color: "#6b7280", marginBottom: 24, lineHeight: 1.6 }}>Your code is saved in the editor, but unsaved progress may be lost. Where would you like to go?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick={() => { setShowBackConfirm(false); onNavigateToBreadcrumb?.("category") }} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, padding: "9px 16px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", cursor: "pointer", textAlign: "left" }}>
                Back to {category === "We_Do" ? "We Do" : category === "I_Do" ? "I Do" : category === "You_Do" ? "You Do" : "exercise list"}
              </button>
              {hierarchy.length > 0 && (
                <button onClick={() => { setShowBackConfirm(false); onNavigateToBreadcrumb?.("hierarchy") }} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, padding: "9px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "none", color: "#374151", cursor: "pointer", textAlign: "left" }}>
                  Back to {hierarchy.slice(-1)[0] || "Topic"}
                </button>
              )}
              <button onClick={() => { setShowBackConfirm(false); onNavigateToBreadcrumb?.("course") }} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, padding: "9px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "none", color: "#374151", cursor: "pointer", textAlign: "left" }}>
                Back to {courseName || "Course"}
              </button>
              <button onClick={() => setShowBackConfirm(false)} style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, padding: "8px 16px", borderRadius: 8, border: "none", background: "none", color: "#9ca3af", cursor: "pointer" }}>Stay in Exercise</button>
            </div>
          </div>
        </div>
      )}

      {pendingNavLevel !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", width: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.35)", border: "1px solid #e5e7eb" }}>
            <p style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 8 }}>Leave Exercise?</p>
            <p style={{ fontFamily: FONT, fontSize: 13, color: "#6b7280", marginBottom: 24, lineHeight: 1.6 }}>Your progress may not be saved if you leave now.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => setPendingNavLevel(null)} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: "11px 16px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", textAlign: "center" }}>Stay in Exercise</button>
              <button onClick={() => { onNavigateToBreadcrumb?.(pendingNavLevel); setPendingNavLevel(null) }} style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, padding: "10px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "none", color: "#6b7280", cursor: "pointer", textAlign: "center" }}>Leave</button>
            </div>
          </div>
        </div>
      )}

      {exData && (
        <ExerciseInfoModals exercise={exData} showDetailsModal={showDetailsModal} setShowDetailsModal={setShowDetailsModal} showOverviewModal={showOverviewModal} setShowOverviewModal={setShowOverviewModal} solvedQuestions={solvedQuestions} />
      )}

      {/* Visualizer modal — full-screen overlay that embeds Python Tutor.
          Click backdrop or X to close. */}
      {showVisualizer && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowVisualizer(false) }}
          style={{ position: "fixed", inset: 0, zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)" }}
        >
          <div style={{ width: "min(1200px, 96vw)", height: "min(820px, 92vh)", background: "#ffffff", borderRadius: 12, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", fontFamily: FONT }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #e5e7eb", background: "#ffffff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Eye style={{ width: 16, height: 16, color: "#4338ca" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Code Visualizer</span>
                <span style={{ fontSize: 11, color: "#6b7280" }}>· step through your code line by line</span>
              </div>
              <button
                onClick={() => setShowVisualizer(false)}
                title="Close visualizer"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#dc2626", cursor: "pointer" }}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
            {/* Body — Python Tutor iframe */}
            <div style={{ flex: 1, position: "relative", background: "#ffffff" }}>
              {visualizerLoading && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "#ffffff", zIndex: 1 }}>
                  <Loader2 className="animate-spin" style={{ width: 24, height: 24, color: "#4338ca" }} />
                  <span style={{ fontSize: 12, color: "#6b7280" }}>Preparing visualizer…</span>
                </div>
              )}
              {visualizerUrl && (
                <iframe
                  src={visualizerUrl}
                  title="Python Tutor visualizer"
                  style={{ width: "100%", height: "100%", border: "none", display: "block", background: "#ffffff" }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                />
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }`}</style>
    </div>
  )
}
