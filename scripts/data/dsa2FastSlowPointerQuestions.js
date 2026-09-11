/**
 * Question bank for the DSA 2 ▸ "Fast & Slow Pointers, Linked List Reversals"
 * seed (see ../seedDsa2FastSlowPointerExercises.js).
 *
 * PROGRAMMING_QUESTIONS are the five problems from
 * "B2I_KIOT_ISSD_JAVA_Phase_II_TechnicalAssessment_05.docx" (Java Phase II —
 * Problem Solving Techniques, 50 marks). Each keeps the document's own test
 * cases as the SAMPLE cases and adds hidden cases for the boundary conditions
 * the constraints name. The document states the problems abstractly ("an
 * integer array nums, an integer k"); a runnable question needs a concrete
 * stdin contract, so each description states one and the starter/solution code
 * reads exactly that.
 *
 * Two deliberate departures from the document, both so the stored data is
 * self-consistent:
 *   • The array problems read the length n on its own line first. The document
 *     writes inputs as `nums = [90,80,70,60,50], k = 2`, which is not a stdin
 *     format.
 *   • Boolean answers are lowercase `true` / `false` throughout. The document's
 *     Output Format says "a boolean", and two of its three examples print
 *     lowercase; the third prints "False", which Java never emits.
 *
 * MCQ_QUESTIONS are authored on this topic's own subject — the source document
 * contains no multiple-choice questions.
 */

const tc = (input, expectedOutput, explanation, isSample) => ({
  input,
  expectedOutput,
  isSample: !!isSample,
  isHidden: !isSample,
  points: 1,
  explanation,
});

const PROGRAMMING_QUESTIONS = [
  {
    title: "Minimum Difference Between Highest and Lowest of K Scores",
    difficulty: "easy",
    description:
      "<p>You are given an integer array <b>nums</b>, where nums[i] represents the score of the i-th student, and an integer <b>k</b>. Choose the scores of any k students such that the difference between the highest score and the lowest score is minimized. Return the minimum possible difference.</p>" +
      "<p><b>Input Format</b></p><ul><li>Line 1: an integer n — the number of scores.</li><li>Line 2: n space-separated integers — the array nums.</li><li>Line 3: an integer k.</li></ul>" +
      "<p><b>Output Format</b></p><ul><li>A single integer: the minimum possible difference between the highest and lowest of any k chosen scores.</li></ul>" +
      "<p><b>Expected Complexity:</b> O(n log n) time and O(1) extra space.</p>",
    constraints: ["1 <= k <= nums.length <= 1000", "0 <= nums[i] <= 10^5"],
    testCases: [
      tc("5\n90 80 70 60 50\n2", "10", "Test Case 1 from the question paper", true),
      tc("4\n9 4 1 7\n2", "2", "Test Case 2 from the question paper", true),
      tc("1\n5\n1", "0", "Lower bound — a single score with k = 1", false),
      tc("6\n1 5 6 14 15 17\n3", "3", "Best window of 3 is [14,15,17]", false),
      tc("5\n100000 0 50000 25000 75000\n5", "100000", "k = n, so the answer is the full range", false),
    ],
    starterCode: [
      "import java.util.Arrays;",
      "import java.util.Scanner;",
      "",
      "public class Main {",
      "",
      "    public static int minimumDifference(int[] nums, int k) {",
      "        // TODO: sort the scores, then scan every window of k consecutive values",
      "        return 0;",
      "    }",
      "",
      "    public static void main(String[] args) {",
      "        Scanner sc = new Scanner(System.in);",
      "        int n = sc.nextInt();",
      "        int[] nums = new int[n];",
      "        for (int i = 0; i < n; i++) nums[i] = sc.nextInt();",
      "        int k = sc.nextInt();",
      "        System.out.println(minimumDifference(nums, k));",
      "        sc.close();",
      "    }",
      "}",
    ].join("\n"),
    solutionCode: [
      "import java.util.Arrays;",
      "import java.util.Scanner;",
      "",
      "public class Main {",
      "",
      "    public static int minimumDifference(int[] nums, int k) {",
      "        Arrays.sort(nums);",
      "        int best = Integer.MAX_VALUE;",
      "        for (int i = 0; i + k - 1 < nums.length; i++) {",
      "            best = Math.min(best, nums[i + k - 1] - nums[i]);",
      "        }",
      "        return best;",
      "    }",
      "",
      "    public static void main(String[] args) {",
      "        Scanner sc = new Scanner(System.in);",
      "        int n = sc.nextInt();",
      "        int[] nums = new int[n];",
      "        for (int i = 0; i < n; i++) nums[i] = sc.nextInt();",
      "        int k = sc.nextInt();",
      "        System.out.println(minimumDifference(nums, k));",
      "        sc.close();",
      "    }",
      "}",
    ].join("\n"),
  },

  {
    title: "Find Pivot Index",
    difficulty: "easy",
    description:
      "<p>Given an array of integers <b>nums</b>, calculate the pivot index of the array. The pivot index is the index where the sum of all the numbers strictly to the left of the index is equal to the sum of all the numbers strictly to the right of the index.</p>" +
      "<p>If the index is on the left edge of the array, the left sum is considered 0. If there is no pivot index, return -1. If there are multiple pivot indexes, return the leftmost pivot index.</p>" +
      "<p><b>Input Format</b></p><ul><li>Line 1: an integer n — the length of nums.</li><li>Line 2: n space-separated integers — the array nums.</li></ul>" +
      "<p><b>Output Format</b></p><ul><li>A single integer: the leftmost pivot index, or -1 if no pivot index exists.</li></ul>" +
      "<p><b>Expected Complexity:</b> O(n) time and O(1) extra space.</p>",
    constraints: ["1 <= nums.length <= 10^4", "-1000 <= nums[i] <= 1000"],
    testCases: [
      tc("6\n1 7 3 6 5 6", "3", "Test Case 1 from the question paper", true),
      tc("3\n1 2 3", "-1", "Test Case 2 from the question paper — no pivot exists", true),
      tc("3\n2 1 -1", "0", "Test Case 3 from the question paper — the left edge counts as sum 0", false),
      tc("1\n0", "0", "Single element — both sides are empty", false),
      tc("5\n-1 -1 -1 -1 -1", "2", "Negative values still balance at the middle index", false),
    ],
    starterCode: [
      "import java.util.Scanner;",
      "",
      "public class Main {",
      "",
      "    public static int pivotIndex(int[] nums) {",
      "        // TODO: compare the running left sum against (total - left - nums[i])",
      "        return -1;",
      "    }",
      "",
      "    public static void main(String[] args) {",
      "        Scanner sc = new Scanner(System.in);",
      "        int n = sc.nextInt();",
      "        int[] nums = new int[n];",
      "        for (int i = 0; i < n; i++) nums[i] = sc.nextInt();",
      "        System.out.println(pivotIndex(nums));",
      "        sc.close();",
      "    }",
      "}",
    ].join("\n"),
    solutionCode: [
      "import java.util.Scanner;",
      "",
      "public class Main {",
      "",
      "    public static int pivotIndex(int[] nums) {",
      "        int total = 0;",
      "        for (int v : nums) total += v;",
      "        int left = 0;",
      "        for (int i = 0; i < nums.length; i++) {",
      "            if (left == total - left - nums[i]) return i;",
      "            left += nums[i];",
      "        }",
      "        return -1;",
      "    }",
      "",
      "    public static void main(String[] args) {",
      "        Scanner sc = new Scanner(System.in);",
      "        int n = sc.nextInt();",
      "        int[] nums = new int[n];",
      "        for (int i = 0; i < n; i++) nums[i] = sc.nextInt();",
      "        System.out.println(pivotIndex(nums));",
      "        sc.close();",
      "    }",
      "}",
    ].join("\n"),
  },

  {
    title: "Check if All the Integers in a Range Are Covered",
    difficulty: "medium",
    description:
      "<p>You are given a 2D integer array <b>ranges</b> and two integers <b>left</b> and <b>right</b>. Each ranges[i] = [start_i, end_i] represents an inclusive interval.</p>" +
      "<p>Return <b>true</b> if every integer in the range [left, right] is covered by at least one interval in ranges, otherwise return <b>false</b>.</p>" +
      "<p><b>Input Format</b></p><ul><li>Line 1: an integer m — the number of ranges.</li><li>Next m lines: two space-separated integers start_i and end_i.</li><li>Last line: two space-separated integers left and right.</li></ul>" +
      "<p><b>Output Format</b></p><ul><li>A boolean printed in lowercase — <code>true</code> if every integer in [left, right] is covered, <code>false</code> otherwise.</li></ul>" +
      "<p><b>Expected Complexity:</b> O(n + range) time and O(1) extra space (range is bounded by the constraints).</p>",
    constraints: [
      "1 <= ranges.length <= 50",
      "1 <= start_i <= end_i <= 50",
      "1 <= left <= right <= 50",
    ],
    testCases: [
      tc("3\n1 2\n3 4\n5 6\n2 5", "true", "Test Case 1 from the question paper", true),
      tc("1\n1 10\n1 10", "true", "Test Case 2 from the question paper — one interval covers everything", true),
      tc("2\n1 2\n3 4\n1 5", "false", "Test Case 3 from the question paper — 5 is uncovered", false),
      tc("1\n50 50\n50 50", "true", "Upper bound of the constraints", false),
      tc("2\n1 10\n10 20\n1 20", "true", "Overlapping intervals cover the whole span", false),
    ],
    starterCode: [
      "import java.util.Scanner;",
      "",
      "public class Main {",
      "",
      "    public static boolean isCovered(int[][] ranges, int left, int right) {",
      "        // TODO: every integer in [left, right] must fall inside at least one interval",
      "        return false;",
      "    }",
      "",
      "    public static void main(String[] args) {",
      "        Scanner sc = new Scanner(System.in);",
      "        int m = sc.nextInt();",
      "        int[][] ranges = new int[m][2];",
      "        for (int i = 0; i < m; i++) {",
      "            ranges[i][0] = sc.nextInt();",
      "            ranges[i][1] = sc.nextInt();",
      "        }",
      "        int left = sc.nextInt();",
      "        int right = sc.nextInt();",
      "        System.out.println(isCovered(ranges, left, right));",
      "        sc.close();",
      "    }",
      "}",
    ].join("\n"),
    solutionCode: [
      "import java.util.Scanner;",
      "",
      "public class Main {",
      "",
      "    public static boolean isCovered(int[][] ranges, int left, int right) {",
      "        for (int x = left; x <= right; x++) {",
      "            boolean covered = false;",
      "            for (int[] r : ranges) {",
      "                if (r[0] <= x && x <= r[1]) { covered = true; break; }",
      "            }",
      "            if (!covered) return false;",
      "        }",
      "        return true;",
      "    }",
      "",
      "    public static void main(String[] args) {",
      "        Scanner sc = new Scanner(System.in);",
      "        int m = sc.nextInt();",
      "        int[][] ranges = new int[m][2];",
      "        for (int i = 0; i < m; i++) {",
      "            ranges[i][0] = sc.nextInt();",
      "            ranges[i][1] = sc.nextInt();",
      "        }",
      "        int left = sc.nextInt();",
      "        int right = sc.nextInt();",
      "        System.out.println(isCovered(ranges, left, right));",
      "        sc.close();",
      "    }",
      "}",
    ].join("\n"),
  },

  {
    title: "Backspace String Compare",
    difficulty: "medium",
    description:
      "<p>Given two strings <b>s</b> and <b>t</b>, return <b>true</b> if they are equal after applying all backspace operations.</p>" +
      "<p>The character '#' represents a backspace. A backspace removes the character immediately before it, if one exists.</p>" +
      "<p><b>Input Format</b></p><ul><li>Line 1: the string s.</li><li>Line 2: the string t.</li></ul>" +
      "<p><b>Output Format</b></p><ul><li>A boolean printed in lowercase — <code>true</code> if s and t are equal after applying all backspaces, <code>false</code> otherwise.</li></ul>" +
      "<p><b>Expected Complexity:</b> O(n + m) time and O(1) extra space.</p>",
    constraints: [
      "1 <= s.length, t.length <= 200",
      "s and t contain lowercase English letters and '#'",
    ],
    testCases: [
      tc("ab#c\nad#c", "true", "Test Case 1 from the question paper — both reduce to \"ac\"", true),
      tc("ab##\nc#d#", "true", "Test Case 2 from the question paper — both reduce to the empty string", true),
      tc("a#c\nb", "false", "Test Case 3 from the question paper", false),
      tc("a##c\n#a#c", "true", "A backspace with nothing before it is ignored", false),
      tc("xy#z\nxyz#", "false", "\"xz\" against \"xy\"", false),
    ],
    starterCode: [
      "import java.util.Scanner;",
      "",
      "public class Main {",
      "",
      "    public static boolean backspaceCompare(String s, String t) {",
      "        // TODO: walk both strings from the back, skipping what each '#' removes",
      "        return false;",
      "    }",
      "",
      "    public static void main(String[] args) {",
      "        Scanner sc = new Scanner(System.in);",
      "        String s = sc.next();",
      "        String t = sc.next();",
      "        System.out.println(backspaceCompare(s, t));",
      "        sc.close();",
      "    }",
      "}",
    ].join("\n"),
    solutionCode: [
      "import java.util.Scanner;",
      "",
      "public class Main {",
      "",
      "    public static boolean backspaceCompare(String s, String t) {",
      "        int i = s.length() - 1, j = t.length() - 1;",
      "        int skipS = 0, skipT = 0;",
      "        while (i >= 0 || j >= 0) {",
      "            while (i >= 0) {",
      "                if (s.charAt(i) == '#') { skipS++; i--; }",
      "                else if (skipS > 0) { skipS--; i--; }",
      "                else break;",
      "            }",
      "            while (j >= 0) {",
      "                if (t.charAt(j) == '#') { skipT++; j--; }",
      "                else if (skipT > 0) { skipT--; j--; }",
      "                else break;",
      "            }",
      "            if (i >= 0 && j >= 0) {",
      "                if (s.charAt(i) != t.charAt(j)) return false;",
      "            } else if (i >= 0 || j >= 0) {",
      "                return false;",
      "            }",
      "            i--; j--;",
      "        }",
      "        return true;",
      "    }",
      "",
      "    public static void main(String[] args) {",
      "        Scanner sc = new Scanner(System.in);",
      "        String s = sc.next();",
      "        String t = sc.next();",
      "        System.out.println(backspaceCompare(s, t));",
      "        sc.close();",
      "    }",
      "}",
    ].join("\n"),
  },

  {
    title: "Subarray Product Less Than K",
    difficulty: "hard",
    description:
      "<p>Given an array of positive integers <b>nums</b> and an integer <b>k</b>, return the number of contiguous subarrays where the product of all the elements in the subarray is strictly less than k.</p>" +
      "<p><b>Input Format</b></p><ul><li>Line 1: an integer n — the length of nums.</li><li>Line 2: n space-separated positive integers — the array nums.</li><li>Line 3: an integer k.</li></ul>" +
      "<p><b>Output Format</b></p><ul><li>A single integer: the count of contiguous subarrays whose product is strictly less than k.</li></ul>" +
      "<p><b>Expected Complexity:</b> O(n) time and O(1) extra space.</p>",
    constraints: ["1 <= nums.length <= 3 * 10^4", "1 <= nums[i] <= 1000", "0 <= k <= 10^6"],
    testCases: [
      tc("4\n10 5 2 6\n100", "8", "Test Case 1 from the question paper", true),
      tc("3\n1 2 3\n0", "0", "Test Case 2 from the question paper — k <= 1 admits nothing", true),
      tc("1\n1\n2", "1", "The single element is the only subarray", false),
      tc("3\n1 1 1\n2", "6", "All six subarrays have product 1", false),
      tc("5\n1 2 3 4 5\n10", "8", "The window shrinks at 24 and again at 20", false),
    ],
    starterCode: [
      "import java.util.Scanner;",
      "",
      "public class Main {",
      "",
      "    public static int numSubarrayProductLessThanK(int[] nums, int k) {",
      "        // TODO: sliding window — grow to the right, shrink from the left while product >= k",
      "        return 0;",
      "    }",
      "",
      "    public static void main(String[] args) {",
      "        Scanner sc = new Scanner(System.in);",
      "        int n = sc.nextInt();",
      "        int[] nums = new int[n];",
      "        for (int i = 0; i < n; i++) nums[i] = sc.nextInt();",
      "        int k = sc.nextInt();",
      "        System.out.println(numSubarrayProductLessThanK(nums, k));",
      "        sc.close();",
      "    }",
      "}",
    ].join("\n"),
    solutionCode: [
      "import java.util.Scanner;",
      "",
      "public class Main {",
      "",
      "    public static int numSubarrayProductLessThanK(int[] nums, int k) {",
      "        if (k <= 1) return 0;",
      "        int count = 0, left = 0;",
      "        long product = 1;",
      "        for (int right = 0; right < nums.length; right++) {",
      "            product *= nums[right];",
      "            while (product >= k) {",
      "                product /= nums[left];",
      "                left++;",
      "            }",
      "            count += right - left + 1;",
      "        }",
      "        return count;",
      "    }",
      "",
      "    public static void main(String[] args) {",
      "        Scanner sc = new Scanner(System.in);",
      "        int n = sc.nextInt();",
      "        int[] nums = new int[n];",
      "        for (int i = 0; i < n; i++) nums[i] = sc.nextInt();",
      "        int k = sc.nextInt();",
      "        System.out.println(numSubarrayProductLessThanK(nums, k));",
      "        sc.close();",
      "    }",
      "}",
    ].join("\n"),
  },
];

const MCQ_QUESTIONS = [
  {
    title: "In Floyd's cycle-detection algorithm, how do the two pointers advance on each iteration?",
    difficulty: "easy",
    options: [
      { text: "slow moves 1 node, fast moves 2 nodes", isCorrect: true },
      { text: "slow moves 1 node, fast moves 3 nodes", isCorrect: false },
      { text: "both move 2 nodes", isCorrect: false },
      { text: "slow moves 2 nodes, fast moves 1 node", isCorrect: false },
    ],
    explanation:
      "The tortoise-and-hare step is 1 and 2. The gap between them grows by exactly one node per iteration, so inside a cycle the fast pointer is guaranteed to catch the slow one.",
  },
  {
    title: "Which technique finds the middle node of a singly linked list in a single pass, without knowing its length?",
    difficulty: "easy",
    options: [
      { text: "Fast and slow pointers", isCorrect: true },
      { text: "Binary search over the node indices", isCorrect: false },
      { text: "Counting the nodes first, then walking length/2 steps", isCorrect: false },
      { text: "Reversing the list recursively", isCorrect: false },
    ],
    explanation:
      "When the fast pointer reaches the end, the slow pointer — moving at half the speed — sits at the middle. Counting first also works, but it needs two passes.",
  },
  {
    title: "A cycle has been detected with fast and slow pointers. What is the standard next step to find the node where the cycle begins?",
    difficulty: "medium",
    options: [
      { text: "Reset one pointer to the head and advance both one node at a time until they meet", isCorrect: true },
      { text: "Keep advancing the fast pointer two nodes at a time until it reaches the head", isCorrect: false },
      { text: "Store every visited node in a set and return the first repeat", isCorrect: false },
      { text: "Reverse the list from the meeting point and return the new head", isCorrect: false },
    ],
    explanation:
      "From the meeting point, the distance to the cycle entry equals the distance from the head to that entry. Walking both pointers one step at a time makes them meet exactly there, in O(1) extra space.",
  },
  {
    title: "What are the time and space complexities of reversing a singly linked list iteratively?",
    difficulty: "medium",
    options: [
      { text: "O(n) time and O(1) space", isCorrect: true },
      { text: "O(n) time and O(n) space", isCorrect: false },
      { text: "O(n log n) time and O(1) space", isCorrect: false },
      { text: "O(n^2) time and O(1) space", isCorrect: false },
    ],
    explanation:
      "A single pass re-points each next pointer using three references (prev, curr, next), so the extra space is constant. The recursive form is also O(n) time but costs O(n) stack space.",
  },
  {
    title: "When reversing a linked list in groups of k, what happens to the final group if fewer than k nodes remain?",
    difficulty: "hard",
    options: [
      { text: "It is left in its original order", isCorrect: true },
      { text: "It is reversed anyway", isCorrect: false },
      { text: "It is dropped from the list", isCorrect: false },
      { text: "It is padded with null nodes and then reversed", isCorrect: false },
    ],
    explanation:
      "The standard k-group reversal only reverses complete groups; a trailing partial group keeps its original order. Check that k nodes are actually available before starting to reverse.",
  },
];

module.exports = { PROGRAMMING_QUESTIONS, MCQ_QUESTIONS };
