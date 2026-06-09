const PedagogyView = require('../../../models/Courses/moduleStructure/pedagogyViewModal');
const mongoose = require('mongoose');
const Module1 = mongoose.model('Module1');
const SubModule1 = mongoose.model('SubModule1');
const Topic1 = mongoose.model('Topic1');
const SubTopic1 = mongoose.model('SubTopic1');
const CourseStructure = mongoose.model('Course-Structure');
const LevelView = require('../../../models/Courses/moduleStructure/levelModel');
const User = require("../../../models/UserModel");
const Role = require('../../../models/RoleModel');


const { createClient } = require("@supabase/supabase-js");
const supabaseKey = process.env.SUPABASE_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, supabaseKey);

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const path = require('path');
const fs = require('fs');


// Configure ffmpeg paths
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);
exports.createPedagogyView = async (req, res) => {
  try {
    const { institution, courses, pedagogies, createdBy } = req.body;

    if (!courses || !pedagogies || !Array.isArray(pedagogies)) {
      return res.status(400).json({
        message: [{ key: 'error', value: 'Required fields are missing (institution, courses, pedagogies)' }]
      });
    }

    const newPedagogy = new PedagogyView({
      institution: req.user.institution,
      courses,
      pedagogies,
      createdBy: req.user.email
    });

    const savedPedagogy = await newPedagogy.save();

    return res.status(201).json({
      message: [{ key: 'success', value: 'PedagogyView created successfully' }],
      pedagogyView: savedPedagogy
    });
  } catch (err) {
    console.error('Error creating PedagogyView:', err);
    return res.status(500).json({ message: [{ key: 'error', value: 'Internal server error' }] });
  }
};

exports.getAllPedagogyViews = async (req, res) => {
  try {
    const pedagogies = await PedagogyView.find()

    return res.status(200).json({
      message: [{ key: 'success', value: 'PedagogyViews retrieved successfully' }],
      pedagogyViews: pedagogies
    });
  } catch (err) {
    console.error('Error retrieving PedagogyViews:', err);
    return res.status(500).json({ message: [{ key: 'error', value: 'Internal server error' }] });
  }
};

exports.getPedagogyViewById = async (req, res) => {
  try {
    const pedagogy = await PedagogyView.findById(req.params.id)

    if (!pedagogy) {
      return res.status(404).json({ message: [{ key: 'error', value: 'PedagogyView not found' }] });
    }

    return res.status(200).json({
      message: [{ key: 'success', value: 'PedagogyView retrieved successfully' }],
      pedagogyView: pedagogy
    });
  } catch (err) {
    console.error('Error retrieving PedagogyView by ID:', err);
    return res.status(500).json({ message: [{ key: 'error', value: 'Internal server error' }] });
  }
};

exports.updatePedagogyView = async (req, res) => {
  try {
    const { institution, courses, pedagogies } = req.body;

    if (!courses || !pedagogies || !Array.isArray(pedagogies)) {
      return res.status(400).json({
        message: [{ key: 'error', value: 'Required fields are missing (courses, pedagogies)' }]
      });
    }

    let pedagogyView = await PedagogyView.findOne({ courses });

    if (!pedagogyView) {
      pedagogyView = new PedagogyView({
        institution: req.user.institution,
        courses,
        pedagogies: [],
        createdBy: req.user.email
      });
    }

    for (const incomingPedagogy of pedagogies) {
      const matchingPedagogy = pedagogyView.pedagogies.find(existingPedagogy => {
        return (
          arraysEqual(
            existingPedagogy.module?.map(id => id.toString()) || [],
            incomingPedagogy.module?.map(id => id.toString()) || []
          ) &&
          arraysEqual(
            existingPedagogy.subModule?.map(id => id.toString()) || [],
            incomingPedagogy.subModule?.map(id => id.toString()) || []
          ) &&
          arraysEqual(
            existingPedagogy.topic?.map(id => id.toString()) || [],
            incomingPedagogy.topic?.map(id => id.toString()) || []
          ) &&
          arraysEqual(
            existingPedagogy.subTopic?.map(id => id.toString()) || [],
            incomingPedagogy.subTopic?.map(id => id.toString()) || []
          )
        );
      });

      if (matchingPedagogy) {
        if (incomingPedagogy.iDo) {
          matchingPedagogy.iDo = mergeActivityArrays(matchingPedagogy.iDo, incomingPedagogy.iDo);
        }
        if (incomingPedagogy.weDo) {
          matchingPedagogy.weDo = mergeActivityArrays(matchingPedagogy.weDo, incomingPedagogy.weDo);
        }
        if (incomingPedagogy.youDo) {
          matchingPedagogy.youDo = mergeActivityArrays(matchingPedagogy.youDo, incomingPedagogy.youDo);
        }
        matchingPedagogy.updatedAt = new Date();
      } else {
        pedagogyView.pedagogies.push({
          ...incomingPedagogy,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    }

    pedagogyView.updatedBy = req.user.email;
    pedagogyView.updatedAt = new Date();
    pedagogyView.markModified('pedagogies');

    const savedPedagogy = await pedagogyView.save();

    return res.status(200).json({
      message: [{ key: 'success', value: 'Pedagogy updated successfully' }],
      pedagogyView: savedPedagogy
    });

  } catch (err) {
    console.error('Error updating pedagogy:', err);
    return res.status(500).json({
      message: [{ key: 'error', value: 'Internal server error' }]
    });
  }
};





function mergeActivityArrays(existing = [], incoming = []) {
  const merged = [...existing];

  for (const incomingActivity of incoming) {
    const existingIndex = merged.findIndex(a => a.type === incomingActivity.type);

    if (existingIndex !== -1) {
      merged[existingIndex] = { ...merged[existingIndex], ...incomingActivity };
    } else {
      merged.push(incomingActivity);
    }
  }

  return merged;
}

function arraysEqual(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;

  const sorted1 = [...arr1].sort();
  const sorted2 = [...arr2].sort();

  return sorted1.every((val, index) => val === sorted2[index]);
}

exports.deletePedagogyView = async (req, res) => {
  try {
    const { activityType, itemId } = req.params;

    // Validate activityType
    const validActivityTypes = ["iDo", "weDo", "youDo"];
    if (!validActivityTypes.includes(activityType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid activity type. Must be one of: iDo, weDo, youDo"
      });
    }

    // Validate itemId
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item ID format"
      });
    }

    // Step 1: Remove the specific activity item
    let doc = await PedagogyView.findOneAndUpdate(
      { [`pedagogies.${activityType}._id`]: itemId },
      {
        $pull: {
          [`pedagogies.$[].${activityType}`]: { _id: itemId }
        }
      },
      { new: true }
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Activity item not found in any pedagogy"
      });
    }

    // Step 2: Filter out pedagogy objects with all activity arrays empty
    doc.pedagogies = doc.pedagogies.filter(p =>
      (p.iDo && p.iDo.length) ||
      (p.weDo && p.weDo.length) ||
      (p.youDo && p.youDo.length)
    );

    // Step 3: If no pedagogies remain, delete the whole document
    if (doc.pedagogies.length === 0) {
      await PedagogyView.findByIdAndDelete(doc._id);
      return res.status(200).json({
        success: true,
        message: "Activity item deleted and document removed because no pedagogies remain"
      });
    }

    // Step 4: Save updated document if some pedagogies remain
    await doc.save();

    res.status(200).json({
      success: true,
      message: "Activity item deleted successfully",
      data: doc
    });

  } catch (error) {
    console.error("Error deleting activity item:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};






exports.deleteDocument = async (req, res) => {
  const { model, id } = req.params; // id can be "id1,id2,id3"

  try {
    // Validate model
    if (!['Module1', 'SubModule1', 'Topic1', 'SubTopic1', 'pedagogy-view', 'level-view'].includes(model)) {
      return res.status(400).json({ message: 'Invalid model specified' });
    }

    // Split comma-separated IDs
    let ids = id.split(",").map(v => v.trim());

    // Validate IDs
    ids = ids.filter(mongoose.Types.ObjectId.isValid);
    if (ids.length === 0) {
      return res.status(400).json({ message: 'Invalid ID(s) format' });
    }

    // Get model instance
    let modelInstance;
    switch (model) {
      case 'Module1':
        modelInstance = Module1;
        break;
      case 'SubModule1':
        modelInstance = SubModule1;
        break;
      case 'Topic1':
        modelInstance = Topic1;
        break;
      case 'SubTopic1':
        modelInstance = SubTopic1;
        break;
      case 'pedagogy-view':
        modelInstance = PedagogyView;
        break;
      case 'level-view':
        modelInstance = LevelView;
        break;
    }

    let deletedCount = 0;

    for (const docId of ids) {
      const docToDelete = await modelInstance.findById(docId);
      if (!docToDelete) continue;

      // Cascade deletion
      await performCascadeDeletion(model, docId);

      // Delete main document
      await modelInstance.findByIdAndDelete(docId);

      if (model !== 'pedagogy-view' && model !== 'level-view') {
        await cleanUpPedagogyReferences(model, docId);
        await cleanUpLevelReferences(model, docId);
        await cleanUpCourseHierarchy(model, docId, docToDelete.courses);
      }

      deletedCount++;
    }

    return res.status(200).json({
      message: `Deleted ${deletedCount} ${model} document(s) successfully`
    });
  } catch (error) {
    console.error('Error deleting documents:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


async function performCascadeDeletion(model, deletedId) {
  try {

    if (model === 'Module1') {
      const directTopics = await Topic1.find({ moduleId: deletedId });

      for (const topic of directTopics) {
        const subTopics = await SubTopic1.find({ topicId: topic._id });

        for (const subTopic of subTopics) {
          await cleanUpPedagogyReferences('SubTopic1', subTopic._id);
          await cleanUpLevelReferences('SubTopic1', subTopic._id);
          await SubTopic1.findByIdAndDelete(subTopic._id);
        }

        await cleanUpPedagogyReferences('Topic1', topic._id);
        await cleanUpLevelReferences('Topic1', topic._id);
        await Topic1.findByIdAndDelete(topic._id);
      }

      const subModules = await SubModule1.find({ moduleId: deletedId });

      for (const subModule of subModules) {
        const topics = await Topic1.find({ subModuleId: subModule._id });

        for (const topic of topics) {
          const subTopics = await SubTopic1.find({ topicId: topic._id });

          for (const subTopic of subTopics) {
            await cleanUpPedagogyReferences('SubTopic1', subTopic._id);
            await cleanUpLevelReferences('SubTopic1', subTopic._id);
            await SubTopic1.findByIdAndDelete(subTopic._id);
          }

          await cleanUpPedagogyReferences('Topic1', topic._id);
          await cleanUpLevelReferences('Topic1', topic._id);
          await Topic1.findByIdAndDelete(topic._id);
        }

        await cleanUpPedagogyReferences('SubModule1', subModule._id);
        await cleanUpLevelReferences('SubModule1', subModule._id);
        await SubModule1.findByIdAndDelete(subModule._id);
      }
    }
    else if (model === 'SubModule1') {
      const topics = await Topic1.find({ subModuleId: deletedId });
      for (const topic of topics) {
        const subTopics = await SubTopic1.find({ topicId: topic._id });

        for (const subTopic of subTopics) {
          await cleanUpPedagogyReferences('SubTopic1', subTopic._id);
          await cleanUpLevelReferences('SubTopic1', subTopic._id);
          await SubTopic1.findByIdAndDelete(subTopic._id);
        }

        await cleanUpPedagogyReferences('Topic1', topic._id);
        await cleanUpLevelReferences('Topic1', topic._id);
        await Topic1.findByIdAndDelete(topic._id);
      }
    }
    else if (model === 'Topic1') {
      const subTopics = await SubTopic1.find({ topicId: deletedId });

      for (const subTopic of subTopics) {
        await cleanUpPedagogyReferences('SubTopic1', subTopic._id);
        await cleanUpLevelReferences('SubTopic1', subTopic._id);
        await SubTopic1.findByIdAndDelete(subTopic._id);
      }
    }

  } catch (error) {
    console.error('Error in cascade deletion:', error);
    throw error;
  }
}

async function cleanUpPedagogyReferences(model, deletedId) {
  try {

    const fieldMap = {
      'Module1': 'module',
      'SubModule1': 'subModule',
      'Topic1': 'topic',
      'SubTopic1': 'subTopic'
    };
    const field = fieldMap[model];

    const pedagogyViews = await PedagogyView.find({
      [`pedagogies.${field}`]: deletedId
    });


    for (const pView of pedagogyViews) {
      let shouldUpdate = false;
      let removedPedagogies = 0;

      for (let i = pView.pedagogies.length - 1; i >= 0; i--) {
        const pedagogy = pView.pedagogies[i];
        const pedagogyId = pedagogy._id;

        if (pedagogy[field] && pedagogy[field].some(refId => refId.toString() === deletedId.toString())) {
          pView.pedagogies.splice(i, 1);
          shouldUpdate = true;
          removedPedagogies++;
        }
      }

      if (pView.pedagogies.length === 0) {
        await PedagogyView.findByIdAndDelete(pView._id);
      }
      else if (shouldUpdate) {
        await pView.save();
      }
    }

  } catch (error) {
    console.error('Error cleaning up pedagogy references:', error);
    throw error;
  }
}

async function cleanUpLevelReferences(model, deletedId) {
  try {

    const fieldMap = {
      'Module1': 'module',
      'SubModule1': 'subModule',
      'Topic1': 'topic',
      'SubTopic1': 'subTopic'
    };
    const field = fieldMap[model];

    const levelViews = await LevelView.find({
      [`levels.${field}`]: deletedId
    });


    for (const lView of levelViews) {
      let shouldUpdate = false;
      let removedLevels = 0;

      for (let i = lView.levels.length - 1; i >= 0; i--) {
        const level = lView.levels[i];
        if (level[field] && level[field].some(refId => refId.toString() === deletedId.toString())) {
          lView.levels.splice(i, 1);
          shouldUpdate = true;
          removedLevels++;
        }
      }

      if (lView.levels.length === 0) {
        await LevelView.findByIdAndDelete(lView._id);
      }
      else if (shouldUpdate) {
        await lView.save();
      }
    }

  } catch (error) {
    console.error('Error cleaning up level references:', error);
    throw error;
  }
}

async function cleanUpCourseHierarchy(model, deletedId, courseId) {
  try {
    const course = await CourseStructure.findById(courseId);
    if (!course) return;
    if (!course.courseHierarchy) {
      course.courseHierarchy = { modules: [] };
    }
    if (!course.courseHierarchy.modules) {
      course.courseHierarchy.modules = [];
    }

    if (model === 'Module1') {
      course.courseHierarchy.modules = course.courseHierarchy.modules.filter(
        mod => mod._id.toString() !== deletedId.toString()
      );
    }
    else if (model === 'SubModule1') {
      for (const module of course.courseHierarchy.modules) {
        if (module.subModules) {
          module.subModules = module.subModules.filter(
            subMod => subMod._id.toString() !== deletedId.toString()
          );
        }
      }
    }
    else if (model === 'Topic1') {
      for (const module of course.courseHierarchy.modules) {
        if (module.subModules) {
          for (const subModule of module.subModules) {
            if (subModule.topics) {
              subModule.topics = subModule.topics.filter(
                topic => topic._id.toString() !== deletedId.toString()
              );
            }
          }
        }
      }
    }
    else if (model === 'SubTopic1') {
      for (const module of course.courseHierarchy.modules) {
        if (module.subModules) {
          for (const subModule of module.subModules) {
            if (subModule.topics) {
              for (const topic of subModule.topics) {
                if (topic.subTopics) {
                  topic.subTopics = topic.subTopics.filter(
                    subTopic => subTopic._id.toString() !== deletedId.toString()
                  );

                  if (topic.subTopics.length === 0) {
                    subModule.topics = subModule.topics.filter(
                      t => t._id.toString() !== topic._id?.toString()
                    );
                  }
                }
              }
            }
          }
        }
      }
    }

    cleanEmptyHierarchyArrays(course.courseHierarchy);

    course.markModified('courseHierarchy');
    await course.save();
  } catch (error) {
    console.error('Error cleaning up course hierarchy:', error);
    throw error;
  }
}

function cleanEmptyHierarchyArrays(hierarchy) {
  if (!hierarchy?.modules) return;

  for (let i = hierarchy.modules.length - 1; i >= 0; i--) {
    const module = hierarchy.modules[i];

    if (module.subModules) {
      for (let j = module.subModules.length - 1; j >= 0; j--) {
        const subModule = module.subModules[j];

        if (subModule.topics) {
          for (let k = subModule.topics.length - 1; k >= 0; k--) {
            const topic = subModule.topics[k];
            if (topic.subTopics && topic.subTopics.length === 0) {
              subModule.topics.splice(k, 1);
            }
          }

          if (subModule.topics.length === 0) {
            module.subModules.splice(j, 1);
          }
        }

        if (!subModule.topics || subModule.topics.length === 0) {
          module.subModules.splice(j, 1);
        }
      }

      if (module.subModules.length === 0) {
        hierarchy.modules.splice(i, 1);
      }
    }

    if (!module.subModules || module.subModules.length === 0) {
      hierarchy.modules.splice(i, 1);
    }
  }
}

exports.getAllCoursesData = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await CourseStructure.findById(courseId).lean().populate({
      path: "singleParticipants",
      populate: [
        {
          path: "user", // First populate user from enrollment
          populate: {
            path: "role", // Then populate role inside user
            model: "Role" // Make sure to specify the model name if different
          }
        }
      ]
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    const modules = await Module1.find({ courses: courseId }).lean();

    const subModules = await SubModule1.find({
      moduleId: { $in: modules.map(m => m._id) }
    }).lean();

    const topics = await Topic1.find({
      $or: [
        { moduleId: { $in: modules.map(m => m._id) } },
        { subModuleId: { $in: subModules.map(sm => sm._id) } }
      ]
    }).lean();

    const subTopics = await SubTopic1.find({
      topicId: { $in: topics.map(t => t._id) }
    }).lean();


    const structuredCourse = {
      ...course,
      modules: modules.map(module => {
        const moduleSubModules = subModules.filter(
          sm => sm.moduleId?.toString() === module._id.toString()
        );

        const processedSubModules = moduleSubModules.map(subModule => {
          const subModuleTopics = topics.filter(
            t => t.subModuleId?.toString() === subModule._id.toString()
          );

          const processedTopics = subModuleTopics.map(topic => ({
            ...topic,
            subTopics: subTopics.filter(
              st => st.topicId?.toString() === topic._id.toString()
            )
          }));

          return {
            ...subModule,
            topics: processedTopics
          };
        });

        const moduleDirectTopics = topics.filter(
          t =>
            t.moduleId?.toString() === module._id.toString() &&
            (!t.subModuleId || !moduleSubModules.some(sm => sm._id.toString() === t.subModuleId?.toString()))
        );

        const processedDirectTopics = moduleDirectTopics.map(topic => ({
          ...topic,
          subTopics: subTopics.filter(
            st => st.topicId?.toString() === topic._id.toString()
          )
        }));

        return {
          ...module,
          subModules: processedSubModules,
          topics: processedDirectTopics
        };
      })
    };

    res.status(200).json({
      success: true,
      data: structuredCourse
    });

  } catch (error) {
    console.error("Error fetching course structure:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};



// ─────────────────────────────────────────────────────────────────────────────
// REVIEW-SUBMISSION endpoint
// ─────────────────────────────────────────────────────────────────────────────
//
// Tailored payload for `client/.../reviewSubmission/page.tsx`. The page only
// needs:
//   • Course-level meta: _id, courseName, courseCode (breadcrumb).
//   • The full course hierarchy (modules/subModules/topics/subTopics) WITH
//     pedagogy — but ONLY the exercise arrays inside pedagogy.We_Do and
//     pedagogy.You_Do. Pedagogy.I_Do (reading notes) and any non-exercise
//     resources (files, folders, AI notes) are dropped — those are MBs of
//     content the grading screen never reads.
//   • singleParticipants populated with the user + role.renameRole + the
//     ONE userCourses entry matching this courseId (which carries the
//     submissions tree). All other enrolment entries on the user are
//     irrelevant here and add up to a lot of payload for multi-course users.
//
// `getAllCoursesData` is intentionally left untouched — other pages still
// depend on its full shape.
exports.getCoursesDataForReview = async (req, res) => {
  try {
    const { courseId } = req.params;

    // 1. Course + enrolments. Project user.permissions OUT (large + unused),
    //    keep just the fields the page reads. user.courses is kept as-is
    //    here because we need to filter to the current course in JS below
    //    (Mongoose doesn't support post-populate $elemMatch projection on
    //    nested array subdocs cleanly).
    const course = await CourseStructure.findById(courseId)
      .select("_id courseName courseCode singleParticipants")
      .lean()
      .populate({
        path: "singleParticipants",
        populate: [
          {
            path: "user",
            select: "_id email firstName lastName phone profile department role courses",
            populate: { path: "role", select: "renameRole" }
          }
        ]
      });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    // Filter each user's `courses` array down to only the entry matching
    // this courseId. The page reads exactly that one entry to extract
    // `answers.We_Do` / `answers.You_Do` submissions for the participant.
    if (Array.isArray(course.singleParticipants)) {
      course.singleParticipants.forEach(p => {
        if (p?.user && Array.isArray(p.user.courses)) {
          p.user.courses = p.user.courses.filter(uc =>
            uc?.courseId?.toString() === courseId.toString()
          );
        }
      });
    }

    // 2. Strip pedagogy down to only exercise arrays. Mutates `node` in
    //    place. `pedagogy.I_Do` (reading material), file/folder resources
    //    inside pedagogy, AI notes, etc. are dropped — only the categories
    //    the client's `collectExercisesWithMetadata` walks remain.
    const EXERCISE_CATEGORIES = [
      "assignments",
      "practical",
      "project_development",
      "assessments",
      "assesments", // legacy misspelling preserved in data
      "assesment",  // legacy misspelling preserved in data
    ];
    const reduceCat = (cat) => {
      if (!cat || typeof cat !== "object") return undefined;
      const out = {};
      EXERCISE_CATEGORIES.forEach(k => {
        if (cat[k] !== undefined) out[k] = cat[k];
      });
      return out;
    };
    const stripPedagogy = (node) => {
      if (!node?.pedagogy) return;
      const p = node.pedagogy;
      node.pedagogy = {
        We_Do: reduceCat(p.We_Do),
        You_Do: reduceCat(p.You_Do),
      };
    };

    // 3. Fetch hierarchy nodes with minimal fields. We need the parent IDs
    //    for the nesting step below.
    const modules = await Module1.find({ courses: courseId })
      .select("_id title pedagogy courses")
      .lean();
    modules.forEach(stripPedagogy);

    const subModules = await SubModule1.find({
      moduleId: { $in: modules.map(m => m._id) }
    })
      .select("_id title moduleId pedagogy")
      .lean();
    subModules.forEach(stripPedagogy);

    const topics = await Topic1.find({
      $or: [
        { moduleId: { $in: modules.map(m => m._id) } },
        { subModuleId: { $in: subModules.map(sm => sm._id) } }
      ]
    })
      .select("_id title moduleId subModuleId pedagogy")
      .lean();
    topics.forEach(stripPedagogy);

    const subTopics = await SubTopic1.find({
      topicId: { $in: topics.map(t => t._id) }
    })
      .select("_id title topicId pedagogy")
      .lean();
    subTopics.forEach(stripPedagogy);

    // 4. Nest the hierarchy with the same shape getAllCoursesData returns,
    //    so the client's `collectExercisesWithMetadata` walker can run
    //    against this payload unchanged.
    const structuredCourse = {
      ...course,
      modules: modules.map(module => {
        const moduleSubModules = subModules.filter(
          sm => sm.moduleId?.toString() === module._id.toString()
        );

        const processedSubModules = moduleSubModules.map(subModule => {
          const subModuleTopics = topics.filter(
            t => t.subModuleId?.toString() === subModule._id.toString()
          );
          const processedTopics = subModuleTopics.map(topic => ({
            ...topic,
            subTopics: subTopics.filter(
              st => st.topicId?.toString() === topic._id.toString()
            )
          }));
          return { ...subModule, topics: processedTopics };
        });

        const moduleDirectTopics = topics.filter(
          t =>
            t.moduleId?.toString() === module._id.toString() &&
            (!t.subModuleId || !moduleSubModules.some(sm => sm._id.toString() === t.subModuleId?.toString()))
        );
        const processedDirectTopics = moduleDirectTopics.map(topic => ({
          ...topic,
          subTopics: subTopics.filter(
            st => st.topicId?.toString() === topic._id.toString()
          )
        }));

        return {
          ...module,
          subModules: processedSubModules,
          topics: processedDirectTopics
        };
      })
    };

    return res.status(200).json({
      success: true,
      data: structuredCourse
    });
  } catch (error) {
    console.error("Error fetching review course data:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// LIGHTWEIGHT "tree skeleton" endpoint
// ─────────────────────────────────────────────────────────────────────────────
//
// Built for `uploadcourseresources` first-paint. The original `getAllCoursesData`
// returns the FULL course payload — every student's submission history
// (`singleParticipants` populated to the user + role + answers level) plus the
// complete `pedagogy` tree for every module / submodule / topic / subtopic.
// The Resources page only renders the sidebar tree + course meta on first
// paint; pedagogy is loaded per-node on demand by `getNodePedagogy` below.
//
// This endpoint therefore:
//   • SKIPS `singleParticipants` entirely (saves the bulk of the payload).
//   • SELECTS only `_id` + `title` per node — no `pedagogy` field comes
//     back, so the per-document JSON shrinks drastically.
//   • Returns course-level fields the page actually reads: `_id`,
//     `courseName`, `courseCode`, `resourcesType`, `testConfiguration`.
//
// `getAllCoursesData` is left untouched — consumers that need the full
// payload (reviewSubmission, the live-dashboard marks computation) keep
// hitting the existing route.
exports.getAllCoursesDataLight = async (req, res) => {
  try {
    const { courseId } = req.params;

    // ── Projection strategy ──
    // Earlier I used a tight allowlist (`.select("_id courseName resourcesType …")`)
    // and dropped pedagogy / nodeIds / subcategory configs / index along
    // with it — which broke `subcategories` useMemo (`d.I_Do.map`),
    // `originalData.courses`, `originalData.topicId`, etc.
    //
    // Lesson: this page reads ENOUGH fields off the course/node documents
    // that maintaining an allowlist is brittle. Switching to an EXCLUSION
    // projection (just drop the heavy fields) gives the user almost the
    // same payload-size win without risking another runtime crash on a
    // field I didn't account for.
    //
    // The bulk of the original payload was:
    //   (a) `singleParticipants` populated to user + role + answers
    //       → avoided by simply NOT calling `.populate()` here.
    //   (b) `pedagogy` on every node (folders + files + AI notes + …)
    //       → excluded via `.select("-pedagogy")` on each node query.
    //
    // The `singleParticipants` field on the course doc is just an array of
    // ObjectIds (refs) when not populated — KBs, not MBs. We can leave it
    // in or strip it; stripping it (`-singleParticipants`) saves a couple
    // more KB and makes the contract explicit.
    const course = await CourseStructure.findById(courseId)
      .select("-singleParticipants")
      .lean();

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    // For each level: exclude pedagogy (heavy), keep everything else.
    // This gives us moduleId/subModuleId/topicId/courses/index/title/etc.
    // — all the small metadata fields the client's upload + breadcrumb +
    // form-data builders depend on.
    const modules = await Module1.find({ courses: courseId })
      .select("-pedagogy")
      .lean();

    const subModules = await SubModule1.find({
      moduleId: { $in: modules.map(m => m._id) },
    })
      .select("-pedagogy")
      .lean();

    const topics = await Topic1.find({
      $or: [
        { moduleId: { $in: modules.map(m => m._id) } },
        { subModuleId: { $in: subModules.map(sm => sm._id) } },
      ],
    })
      .select("-pedagogy")
      .lean();

    const subTopics = await SubTopic1.find({
      topicId: { $in: topics.map(t => t._id) },
    })
      .select("-pedagogy")
      .lean();

    // Same nesting shape as the heavy endpoint so the existing client-side
    // `transformToCourseNodes` walker keeps working unchanged. The node
    // objects here carry every field they did before EXCEPT `pedagogy`.
    const structuredCourse = {
      ...course,
      modules: modules.map((module) => {
        const moduleSubModules = subModules.filter(
          (sm) => sm.moduleId?.toString() === module._id.toString(),
        );
        const processedSubModules = moduleSubModules.map((subModule) => {
          const subModuleTopics = topics.filter(
            (t) => t.subModuleId?.toString() === subModule._id.toString(),
          );
          const processedTopics = subModuleTopics.map((topic) => ({
            ...topic,
            subTopics: subTopics.filter(
              (st) => st.topicId?.toString() === topic._id.toString(),
            ),
          }));
          return {
            ...subModule,
            topics: processedTopics,
          };
        });

        const moduleDirectTopics = topics.filter(
          (t) =>
            t.moduleId?.toString() === module._id.toString() &&
            (!t.subModuleId ||
              !moduleSubModules.some(
                (sm) => sm._id.toString() === t.subModuleId?.toString(),
              )),
        );
        const processedDirectTopics = moduleDirectTopics.map((topic) => ({
          ...topic,
          subTopics: subTopics.filter(
            (st) => st.topicId?.toString() === topic._id.toString(),
          ),
        }));

        return {
          ...module,
          subModules: processedSubModules,
          topics: processedDirectTopics,
        };
      }),
    };

    return res.status(200).json({
      success: true,
      data: structuredCourse,
    });
  } catch (error) {
    console.error("Error fetching light course structure:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE NODE PEDAGOGY endpoint
// ─────────────────────────────────────────────────────────────────────────────
//
// Returns ONLY the pedagogy + a few node-level fields the client needs for
// the currently-selected sidebar node. Used to replace the second full
// `/getAll/courses-data/:courseId` fetch the Resources page does inside
// `fetchAndRefresh` — that round-trip was downloading the entire course
// payload again just to grab one node's pedagogy.
//
// `:type` is one of: module | submodule | topic | subtopic
// `:id`   is the node's MongoDB `_id`.
//
// We also surface `testConfiguration` because the client reads that on the
// selected node for the I-Do tab strip (line 1087 in page.tsx).
exports.getNodePedagogy = async (req, res) => {
  try {
    const { type, id } = req.params;

    // Map URL type to the right Mongoose model. Keep an allowlist so a
    // malformed `:type` can't accidentally hit some other model.
    const MODEL_BY_TYPE = {
      module: Module1,
      submodule: SubModule1,
      topic: Topic1,
      subtopic: SubTopic1,
    };
    const Model = MODEL_BY_TYPE[String(type).toLowerCase()];
    if (!Model) {
      return res.status(400).json({
        success: false,
        message: `Unknown node type "${type}". Expected one of: module, submodule, topic, subtopic.`,
      });
    }

    // We only want pedagogy + a couple of small siblings; everything else on
    // the document (timestamps, large legacy arrays, etc.) is unnecessary.
    const node = await Model.findById(id)
      .select("_id title pedagogy testConfiguration")
      .lean();

    if (!node) {
      return res.status(404).json({
        success: false,
        message: `${type} not found`,
      });
    }

    return res.status(200).json({
      success: true,
      data: node,
    });
  } catch (error) {
    console.error("Error fetching node pedagogy:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getAllCoursesDataWithoutAINotes = async (req, res) => {
  try {
    const { courseId, exerciseId } = req.params;

    if (!exerciseId) {
      return res.status(400).json({
        success: false,
        message: "Exercise ID is required"
      });
    }

    // Find the course with participants and complete user data
    const course = await CourseStructure.findById(courseId)
      .populate({
        path: 'singleParticipants.user',
        select: '-notes -ai_history -password -tokens -__v -notifications',
        populate: [
          {
            path: 'role',
            select: 'name description'
          },
          {
            path: 'courses.courseId',
            select: 'courseName courseCode description'
          }
        ]
      })
      .lean();

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    // Process participants data
    const singleParticipants = await Promise.all(
      course.singleParticipants.map(async (participant) => {
        if (!participant.user) {
          return {
            ...participant,
            user_Data: null,
            hasExerciseProgress: false,
            exerciseProgress: null
          };
        }

        // Get user's course progress
        const user = await User.findById(participant.user._id)
          .select('courses')
          .lean();

        // Find course progress for this specific course
        const courseProgress = user?.courses?.find(
          cp => cp.courseId && cp.courseId.toString() === courseId
        );

        let hasExerciseProgress = false;
        let exerciseProgress = null;

        if (courseProgress && courseProgress.answers) {
          // Search for this exercise in user's progress
          for (const category in courseProgress.answers) {
            const categoryData = courseProgress.answers[category];
            if (categoryData && typeof categoryData === 'object') {
              for (const key in categoryData) {
                let exercises = categoryData[key];

                // Ensure exercises is an array
                let exercisesArray = [];
                if (Array.isArray(exercises)) {
                  exercisesArray = exercises;
                } else if (exercises && typeof exercises === 'object') {
                  exercisesArray = Object.values(exercises);
                }

                // Find exercise in this category
                const foundExercise = exercisesArray.find(ex =>
                  ex && ex.exerciseId && ex.exerciseId.toString() === exerciseId
                );

                if (foundExercise) {
                  hasExerciseProgress = true;
                  exerciseProgress = {
                    category,
                    subcategory: key,
                    ...foundExercise
                  };
                  break;
                }
              }
            }
            if (hasExerciseProgress) break;
          }
        }

        // Clean user data
        const cleanUserData = JSON.parse(JSON.stringify(participant.user, (key, value) => {
          if (key === 'notes' || key === 'ai_history' || key === 'password' ||
            key === 'tokens' || key === '__v' || key === '$__' ||
            key === '$isNew' || value === undefined) {
            return undefined;
          }
          return value;
        }));

        return {
          _id: participant._id,
          status: participant.status,
          enableEnrolmentDates: participant.enableEnrolmentDates,
          enrolmentStartsDate: participant.enrolmentStartsDate,
          enrolmentEndsDate: participant.enrolmentEndsDate,
          createdAt: participant.createdAt,
          updatedAt: participant.updatedAt,
          user_Data: cleanUserData,
          hasExerciseProgress,
          exerciseProgress
        };
      })
    );

    // Count participants with exercise progress
    const participantsWithProgress = singleParticipants.filter(p => p.hasExerciseProgress).length;

    // Find topics that contain the exercise
    const topics = await Topic1.find({ courses: courseId })
      .select('-__v -createdAt -updatedAt')
      .lean();

    // Find the specific exercise within topics
    let foundExercise = null;
    let parentTopic = null;
    let exerciseCategory = null;
    let exerciseSubcategory = null;

    // Search for exercise in topics
    for (const topic of topics) {
      if (topic.pedagogy) {
        const searchResult = searchForExerciseInPedagogy(topic.pedagogy, exerciseId);
        if (searchResult.found) {
          foundExercise = searchResult.found;
          parentTopic = topic;
          exerciseCategory = searchResult.category;
          exerciseSubcategory = searchResult.subcategory;
          break;
        }
      }
    }

    if (!foundExercise) {
      return res.status(404).json({
        success: false,
        message: "Exercise not found in any topic for this course"
      });
    }

    // Helper function to search for exercise in pedagogy
    function searchForExerciseInPedagogy(pedagogy, targetExerciseId) {
      for (const category in pedagogy) {
        const categoryData = pedagogy[category];
        if (categoryData && typeof categoryData === 'object') {
          for (const subcategory in categoryData) {
            const subcategoryData = categoryData[subcategory];

            if (Array.isArray(subcategoryData)) {
              // Search in array
              const exercise = subcategoryData.find(ex =>
                ex && ex._id && ex._id.toString() === targetExerciseId
              );
              if (exercise) {
                return { found: exercise, category, subcategory };
              }
            } else if (subcategoryData && subcategoryData._id &&
              subcategoryData._id.toString() === targetExerciseId) {
              // Search in object
              return { found: subcategoryData, category, subcategory };
            }
          }
        }
      }
      return { found: null, category: null, subcategory: null };
    }

    // Fetch course structure components
    const modules = await Module1.find({ courses: courseId })
      .select('-__v -createdAt -updatedAt')
      .lean();

    // Get parent module for the topic
    let parentModule = null;
    if (parentTopic) {
      parentModule = modules.find(
        module => module._id.toString() === parentTopic.moduleId?.toString()
      );
    }

    // Build clean exercise response without duplication
    const cleanExerciseResponse = {
      _id: foundExercise._id,
      exerciseName: foundExercise.exerciseInformation?.exerciseName || 'Unnamed Exercise',
      description: foundExercise.exerciseInformation?.description || '',
      exerciseLevel: foundExercise.exerciseInformation?.exerciseLevel || '',
      totalQuestions: foundExercise.exerciseInformation?.totalQuestions || 0,
      estimatedTime: foundExercise.exerciseInformation?.estimatedTime || 0,
      category: exerciseCategory,
      subcategory: exerciseSubcategory,
      questions: foundExercise.questions || [],
      programmingSettings: foundExercise.programmingSettings || {},
      scoreSettings: foundExercise.scoreSettings || {},
      parentTopic: parentTopic ? {
        _id: parentTopic._id,
        title: parentTopic.title,
        description: parentTopic.description
      } : null,
      parentModule: parentModule ? {
        _id: parentModule._id,
        moduleName: parentModule.title,
        description: parentModule.description
      } : null,
      createdAt: foundExercise.createdAt,
      updatedAt: foundExercise.updatedAt
    };

    // Prepare modules data without duplicating exercise info
    const modulesData = modules.map(module => {
      // Get topics for this module
      const moduleTopics = topics.filter(t =>
        t.moduleId?.toString() === module._id.toString()
      );

      const topicsData = moduleTopics.map(topic => {
        // Check if this topic contains the searched exercise
        const containsSearchedExercise = topic._id.toString() === parentTopic?._id?.toString();

        // Get exercises from this topic (excluding the searched exercise to avoid duplication)
        let topicExercises = [];
        if (topic.pedagogy) {
          topicExercises = getAllExercisesFromPedagogy(topic.pedagogy);

          // Remove the searched exercise from the list
          topicExercises = topicExercises.filter(ex =>
            ex._id.toString() !== exerciseId
          );
        }

        return {
          _id: topic._id,
          title: topic.title,
          description: topic.description,
          level: topic.level,
          duration: topic.duration,
          index: topic.index,
          containsSearchedExercise,
          otherExercises: topicExercises.map(ex => ({
            _id: ex._id,
            name: ex.exerciseInformation?.exerciseName || 'Unnamed Exercise',
            category: ex.category,
            subcategory: ex.subcategory
          }))
        };
      });

      return {
        _id: module._id,
        title: module.title,
        description: module.description,
        level: module.level,
        duration: module.duration,
        index: module.index,
        topics: topicsData
      };
    });

    // Helper function to get all exercises from pedagogy
    function getAllExercisesFromPedagogy(pedagogy) {
      const exercises = [];

      for (const category in pedagogy) {
        const categoryData = pedagogy[category];
        if (categoryData && typeof categoryData === 'object') {
          for (const subcategory in categoryData) {
            const subcategoryData = categoryData[subcategory];

            if (Array.isArray(subcategoryData)) {
              subcategoryData.forEach(exercise => {
                if (exercise && exercise._id) {
                  exercises.push({
                    ...exercise,
                    category,
                    subcategory
                  });
                }
              });
            } else if (subcategoryData && subcategoryData._id) {
              exercises.push({
                ...subcategoryData,
                category,
                subcategory
              });
            }
          }
        }
      }

      return exercises;
    }

    // Construct final response
    const responseData = {
      _id: course._id,
      courseName: course.courseName,
      courseCode: course.courseCode,
      description: course.description,
      exercise: cleanExerciseResponse,
      singleParticipants: singleParticipants,
      modules: modulesData,

    };

    res.status(200).json({
      success: true,
      data: responseData,
      message: `Course data with exercise ID fetched successfully (${exerciseCategory || 'unknown'}/${exerciseSubcategory || 'unknown'})`
    });

  } catch (error) {
    console.error("Error fetching course structure:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

exports.studentDashboardAnalyticsOptimized = async (req, res) => {
  try {
    const { institution } = req.user;

    // Get all courses with ALL basic info
    const courses = await CourseStructure.find({ institution })
      .select('courseName courseCode description courseDuration courseLevel serviceType courseImage clientName createdAt updatedAt')
      .lean();

    if (!courses || courses.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "No courses found"
      });
    }

    // Get all course IDs as strings
    const courseIds = courses.map(course => course._id.toString());

    // Get all module IDs for these courses with ALL fields
    const allModules = await Module1.find({ courses: { $in: courseIds } })
      .select('-__v -createdAt -updatedAt')
      .lean();

    // Extract module IDs
    const moduleIds = allModules.map(module => module._id.toString());

    // Batch fetch all related data in parallel with ALL fields
    const [
      allSubModules,
      allTopics,
      allSubTopics,
      allParticipants
    ] = await Promise.all([
      // Get all submodules for these modules with ALL fields
      SubModule1.find({ moduleId: { $in: moduleIds } })
        .select('-__v -createdAt -updatedAt')
        .lean(),
      // Get all topics for these modules and submodules with ALL fields
      Topic1.find({
        $or: [
          { moduleId: { $in: moduleIds } },
          { subModuleId: { $in: await SubModule1.find({ moduleId: { $in: moduleIds } }).distinct('_id') } }
        ]
      })
        .select('-__v -createdAt -updatedAt')
        .lean(),
      // Get all subtopics with ALL fields
      SubTopic1.find()
        .select('-__v -createdAt -updatedAt')
        .lean(),
      // Get all participants with user data for all courses
      CourseStructure.find({ institution })
        .populate({
          path: 'singleParticipants.user',
          select: 'firstName lastName email phone department role status'
        })
        .select('singleParticipants')
        .lean()
    ]);

    // Organize data by course for faster access
    const modulesByCourse = {};
    const participantsByCourse = {};

    // Organize modules by course
    allModules.forEach(module => {
      // Handle both array and single course reference
      const moduleCourses = Array.isArray(module.courses)
        ? module.courses
        : [module.courses];

      moduleCourses.forEach(courseRef => {
        if (courseRef) {
          const courseId = courseRef.toString();
          if (!modulesByCourse[courseId]) {
            modulesByCourse[courseId] = [];
          }
          modulesByCourse[courseId].push(module);
        }
      });
    });

    // Organize participants by course
    allParticipants.forEach(course => {
      participantsByCourse[course._id.toString()] = course.singleParticipants || [];
    });

    // Process each course
    const coursesWithData = courses.map(course => {
      const courseIdStr = course._id.toString();
      const courseModules = modulesByCourse[courseIdStr] || [];
      const courseModuleIds = courseModules.map(m => m._id.toString());

      // Filter submodules for this course
      const courseSubModules = allSubModules.filter(
        sm => sm.moduleId && courseModuleIds.includes(sm.moduleId.toString())
      );

      const courseSubModuleIds = courseSubModules.map(sm => sm._id.toString());

      // Filter topics for this course
      const courseTopics = allTopics.filter(
        t => (t.moduleId && courseModuleIds.includes(t.moduleId.toString())) ||
          (t.subModuleId && courseSubModuleIds.includes(t.subModuleId.toString()))
      );

      const courseTopicIds = courseTopics.map(t => t._id.toString());

      // Filter subtopics for this course
      const courseSubTopics = allSubTopics.filter(
        st => st.topicId && courseTopicIds.includes(st.topicId.toString())
      );

      // Count participants for this course
      const courseParticipants = participantsByCourse[courseIdStr] || [];
      const activeParticipants = courseParticipants.filter(p => p.status === 'active').length;

      // Structure modules with their nested data
      const structuredModules = courseModules.map(module => {
        const moduleSubModules = courseSubModules.filter(
          sm => sm.moduleId && sm.moduleId.toString() === module._id.toString()
        );

        const subModuleIds = moduleSubModules.map(sm => sm._id.toString());

        const moduleTopics = courseTopics.filter(
          t => (t.moduleId && t.moduleId.toString() === module._id.toString()) ||
            (t.subModuleId && subModuleIds.includes(t.subModuleId.toString()))
        );

        const processedSubModules = moduleSubModules.map(subModule => {
          const subModuleTopics = courseTopics.filter(
            t => t.subModuleId && t.subModuleId.toString() === subModule._id.toString()
          );

          const processedTopics = subModuleTopics.map(topic => ({
            ...topic,
            subTopics: courseSubTopics.filter(
              st => st.topicId && st.topicId.toString() === topic._id.toString()
            )
          }));

          return {
            ...subModule,
            topics: processedTopics
          };
        });

        return {
          ...module,
          subModules: processedSubModules,
          topics: moduleTopics.filter(
            t => !t.subModuleId || !subModuleIds.includes(t.subModuleId.toString())
          ).map(topic => ({
            ...topic,
            subTopics: courseSubTopics.filter(
              st => st.topicId && st.topicId.toString() === topic._id.toString()
            )
          }))
        };
      });

      return {
        ...course,
        _id: courseIdStr, // Ensure _id is string
        stats: {
          participants: courseParticipants.length,
          activeParticipants,
          modules: courseModules.length,
          subModules: courseSubModules.length,
          topics: courseTopics.length,
          subTopics: courseSubTopics.length
        },
        modules: structuredModules,
        participants: courseParticipants
      };
    });

    // Calculate overall analytics
    const overallStats = {
      totalCourses: coursesWithData.length,
      totalModules: coursesWithData.reduce((sum, course) => sum + course.stats.modules, 0),
      totalSubModules: coursesWithData.reduce((sum, course) => sum + course.stats.subModules, 0),
      totalTopics: coursesWithData.reduce((sum, course) => sum + course.stats.topics, 0),
      totalSubTopics: coursesWithData.reduce((sum, course) => sum + course.stats.subTopics, 0),
      totalParticipants: coursesWithData.reduce((sum, course) => sum + course.stats.participants, 0),
      totalActiveParticipants: coursesWithData.reduce((sum, course) => sum + course.stats.activeParticipants, 0)
    };

    // Calculate courses by level and service type
    const coursesByLevel = {};
    const coursesByService = {};

    coursesWithData.forEach(course => {
      const level = course.courseLevel || 'Not Specified';
      const service = course.serviceType || 'Not Specified';

      coursesByLevel[level] = (coursesByLevel[level] || 0) + 1;
      coursesByService[service] = (coursesByService[service] || 0) + 1;
    });

    res.status(200).json({
      success: true,
      data: {
        courses: coursesWithData,
        analytics: overallStats,
        summary: {
          coursesByLevel,
          coursesByService
        }
      },
      message: "All courses analytics fetched successfully"
    });

  } catch (error) {
    console.error("Error fetching courses analytics:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

// staffAnalyticsController.js


exports.staffStudentAnalytics = async (req, res) => {
  try {
    const { institution } = req.user;
    const staffId = req.user._id;

    // Get all courses with participants
    const courses = await CourseStructure.find({ institution })
      .select('courseName courseCode courseLevel serviceType courseImage')
      .populate({
        path: 'singleParticipants.user',
        select: 'firstName lastName email department role',
        populate: {
          path: 'role',
          select: 'renameRole originalRole roleValue',
          model: 'Role'
        }
      })
      .lean();

    if (!courses || courses.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "No courses found"
      });
    }

    // Filter courses to only those with students
    const coursesWithStudents = courses.filter(course =>
      course.singleParticipants &&
      course.singleParticipants.length > 0
    );

    const allCourseIds = coursesWithStudents.map(course => course._id.toString());

    // Get all modules and topics for these courses
    const [allModules, allTopics] = await Promise.all([
      Module1.find({ courses: { $in: allCourseIds } })
        .select('title courses')
        .lean(),
      Topic1.find({ courses: { $in: allCourseIds } })
        .select('pedagogy courses')
        .lean()
    ]);

    // Get all users enrolled in these courses
    const allUsers = await User.find({
      institution,
      'courses.courseId': { $in: allCourseIds }
    })
      .select('firstName lastName email department courses role')
      .populate({
        path: 'role',
        select: 'renameRole originalRole roleValue',
        model: 'Role'
      })
      .lean();

    // Filter only students based on role value
    const studentUsers = allUsers.filter(user => {
      const roleValue = user.role?.roleValue || user.role?.renameRole || '';
      return roleValue.toLowerCase() === 'student';
    });

    // Organize modules by course
    const modulesByCourse = {};
    allModules.forEach(module => {
      const moduleCourses = Array.isArray(module.courses) ? module.courses : [module.courses];
      moduleCourses.forEach(courseId => {
        const courseIdStr = courseId.toString();
        if (!modulesByCourse[courseIdStr]) {
          modulesByCourse[courseIdStr] = [];
        }
        modulesByCourse[courseIdStr].push(module);
      });
    });

    // Organize topics by course
    const topicsByCourse = {};
    allTopics.forEach(topic => {
      const topicCourses = Array.isArray(topic.courses) ? topic.courses : [topic.courses];
      topicCourses.forEach(courseId => {
        const courseIdStr = courseId.toString();
        if (!topicsByCourse[courseIdStr]) {
          topicsByCourse[courseIdStr] = [];
        }
        topicsByCourse[courseIdStr].push(topic);
      });
    });

    // Helper function to extract all pedagogy types and categories
    const extractPedagogyStructure = (topics) => {
      const structure = {};

      topics.forEach(topic => {
        if (topic.pedagogy && typeof topic.pedagogy === 'object') {
          Object.keys(topic.pedagogy).forEach(pedagogyType => {
            if (!structure[pedagogyType]) {
              structure[pedagogyType] = new Set();
            }

            const pedagogySection = topic.pedagogy[pedagogyType];
            if (pedagogySection && typeof pedagogySection === 'object') {
              Object.keys(pedagogySection).forEach(category => {
                structure[pedagogyType].add(category);
              });
            }
          });
        }
      });

      // Convert Sets to Arrays
      const result = {};
      Object.keys(structure).forEach(pedagogyType => {
        result[pedagogyType] = Array.from(structure[pedagogyType]);
      });

      return result;
    };

    // Helper function to calculate completion dynamically
    const calculateCompletion = (exercises) => {
      if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
        return { completed: 0, total: 0, percentage: 0, questionProgress: 0 };
      }

      let completed = 0;
      let totalQuestions = 0;
      let attemptedQuestions = 0;

      exercises.forEach(exercise => {
        if (exercise.questions && exercise.questions.length > 0) {
          totalQuestions += exercise.questions.length;
          const attempted = exercise.questions.filter(q =>
            q.status === 'attempted' || q.status === 'evaluated' || q.submittedAt
          ).length;
          attemptedQuestions += attempted;

          if (attempted > 0) {
            completed++;
          }
        }
      });

      return {
        completed,
        total: exercises.length,
        percentage: exercises.length > 0 ? Math.round((completed / exercises.length) * 100) : 0,
        questionProgress: totalQuestions > 0 ? Math.round((attemptedQuestions / totalQuestions) * 100) : 0
      };
    };

    // Process analytics for each course
    const coursesAnalytics = coursesWithStudents.map(course => {
      const courseIdStr = course._id.toString();
      const courseStudents = course.singleParticipants || [];

      // Filter only students (roleValue = 'Student')
      const studentParticipants = courseStudents.filter(participant => {
        const student = participant.user;
        if (!student || !student.role) return false;

        const roleValue = student.role.roleValue || student.role.renameRole || '';
        return roleValue.toLowerCase() === 'student';
      });

      // Get course topics and extract pedagogy structure
      const courseTopics = topicsByCourse[courseIdStr] || [];
      const pedagogyStructure = extractPedagogyStructure(courseTopics);

      // Count total exercises in course
      const totalExercisesInCourse = courseTopics.reduce((total, topic) => {
        if (topic.pedagogy && typeof topic.pedagogy === 'object') {
          Object.keys(topic.pedagogy).forEach(pedagogyType => {
            const pedagogySection = topic.pedagogy[pedagogyType];
            if (pedagogySection && typeof pedagogySection === 'object') {
              Object.keys(pedagogySection).forEach(category => {
                const exercises = pedagogySection[category];
                if (Array.isArray(exercises)) {
                  total += exercises.length;
                }
              });
            }
          });
        }
        return total;
      }, 0);

      // Process each student's progress
      const studentsAnalytics = studentParticipants.map(participant => {
        const student = participant.user;
        if (!student) return null;

        // Find user from studentUsers
        const userData = studentUsers.find(u => u._id.toString() === student._id.toString());
        if (!userData) return null;

        // Get student's course data
        const studentCourse = userData.courses?.find(c =>
          c.courseId && c.courseId.toString() === courseIdStr
        );

        const studentAnswers = studentCourse?.answers || {};

        // Calculate progress for each pedagogy type and category dynamically
        const progress = {};
        let totalAttempts = 0;
        let totalPossibleAttempts = 0;

        // Initialize progress structure
        Object.keys(pedagogyStructure).forEach(pedagogyType => {
          progress[pedagogyType] = {};
          pedagogyStructure[pedagogyType].forEach(category => {
            // Get student's answers for this category
            const categoryAnswers = studentAnswers[pedagogyType]?.[category] || [];
            const categoryProgress = calculateCompletion(categoryAnswers);

            progress[pedagogyType][category] = categoryProgress;

            // Count total attempts
            totalAttempts += categoryProgress.completed;
            totalPossibleAttempts += categoryProgress.total;
          });
        });

        // Calculate overall progress
        const overallProgress = totalPossibleAttempts > 0
          ? Math.round((totalAttempts / totalPossibleAttempts) * 100)
          : 0;

        return {
          student: {
            _id: student._id,
            firstName: student.firstName,
            lastName: student.lastName,
            email: student.email,
            department: student.department,
            role: {
              renameRole: student.role?.renameRole,
              originalRole: student.role?.originalRole,
              roleValue: student.role?.roleValue
            },
            enrolledAt: participant.createdAt
          },
          progress: {
            overall: overallProgress,
            ...progress,
            metadata: {
              totalExercisesInCourse,
              totalAttempts,
              totalPossibleAttempts,
              pedagogyStructure
            }
          },
          lastActivity: studentCourse?.lastAccessed || null
        };
      }).filter(student => student !== null);

      // Calculate course-level statistics
      const courseStats = {
        totalStudents: studentsAnalytics.length,
        averageProgress: studentsAnalytics.length > 0
          ? Math.round(studentsAnalytics.reduce((sum, s) => sum + s.progress.overall, 0) / studentsAnalytics.length)
          : 0,
        completedStudents: studentsAnalytics.filter(s => s.progress.overall >= 80).length,
        inProgressStudents: studentsAnalytics.filter(s => s.progress.overall > 0 && s.progress.overall < 80).length,
        notStartedStudents: studentsAnalytics.filter(s => s.progress.overall === 0).length,

        // Dynamic category stats
        categoryStats: {}
      };

      // Calculate average completion for each pedagogy category
      if (studentsAnalytics.length > 0) {
        Object.keys(pedagogyStructure).forEach(pedagogyType => {
          pedagogyStructure[pedagogyType].forEach(category => {
            const categoryKey = `${pedagogyType}_${category}`;
            courseStats.categoryStats[categoryKey] = {
              averageCompletion: Math.round(studentsAnalytics.reduce((sum, s) =>
                sum + (s.progress[pedagogyType]?.[category]?.percentage || 0), 0) / studentsAnalytics.length
              )
            };
          });
        });
      }

      return {
        course: {
          _id: course._id,
          courseName: course.courseName,
          courseCode: course.courseCode,
          courseLevel: course.courseLevel,
          serviceType: course.serviceType,
          courseImage: course.courseImage,
          totalModules: modulesByCourse[courseIdStr]?.length || 0,
          totalParticipants: course.singleParticipants?.length || 0,
          totalStudents: studentParticipants.length,
          pedagogyStructure // Include pedagogy structure in course info
        },
        stats: courseStats,
        students: studentsAnalytics
      };
    });

    // Calculate overall institution statistics
    const overallStats = {
      totalCourses: coursesAnalytics.length,
      totalStudents: coursesAnalytics.reduce((sum, course) => sum + course.stats.totalStudents, 0),
      averageCourseProgress: coursesAnalytics.length > 0
        ? Math.round(coursesAnalytics.reduce((sum, course) => sum + course.stats.averageProgress, 0) / coursesAnalytics.length)
        : 0,

      performanceDistribution: {
        excellent: coursesAnalytics.filter(course => course.stats.averageProgress >= 80).length,
        good: coursesAnalytics.filter(course => course.stats.averageProgress >= 50 && course.stats.averageProgress < 80).length,
        average: coursesAnalytics.filter(course => course.stats.averageProgress >= 30 && course.stats.averageProgress < 50).length,
        poor: coursesAnalytics.filter(course => course.stats.averageProgress < 30).length
      },

      // Collect all unique pedagogy categories across all courses
      allPedagogyCategories: {}
    };

    // Aggregate all pedagogy categories
    coursesAnalytics.forEach(course => {
      if (course.course.pedagogyStructure) {
        Object.keys(course.course.pedagogyStructure).forEach(pedagogyType => {
          if (!overallStats.allPedagogyCategories[pedagogyType]) {
            overallStats.allPedagogyCategories[pedagogyType] = new Set();
          }
          course.course.pedagogyStructure[pedagogyType].forEach(category => {
            overallStats.allPedagogyCategories[pedagogyType].add(category);
          });
        });
      }
    });

    // Convert Sets to Arrays
    Object.keys(overallStats.allPedagogyCategories).forEach(pedagogyType => {
      overallStats.allPedagogyCategories[pedagogyType] =
        Array.from(overallStats.allPedagogyCategories[pedagogyType]);
    });

    res.status(200).json({
      success: true,
      data: {
        courses: coursesAnalytics,
        overall: overallStats
      },
      message: "Staff analytics fetched successfully"
    });

  } catch (error) {
    console.error("Error fetching staff analytics:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

exports.getStudentCourseProgress = async (req, res) => {
  try {
    const { courseId, studentId } = req.params;
    const { institution } = req.user;

    // Get course details
    const course = await CourseStructure.findOne({
      _id: courseId,
      institution
    }).select('courseName courseCode courseLevel').lean();

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    // Get student details with role populated
    const student = await User.findOne({
      _id: studentId,
      institution
    })
      .select('firstName lastName email department phone role')
      .populate({
        path: 'role',
        select: 'renameRole originalRole roleValue',
        model: 'Role'
      })
      .lean();

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found"
      });
    }

    // Get student's course data with answers
    const studentCourse = await User.findOne({
      _id: studentId,
      'courses.courseId': courseId
    }).select('courses.$').lean();

    // Get all topics for this course
    const topics = await Topic1.find({
      courses: courseId
    })
      .select('title pedagogy')
      .lean();

    const answers = studentCourse?.courses?.[0]?.answers || {};

    // Extract all exercises from topics dynamically
    const allExercises = [];
    const exerciseSummary = {};

    topics.forEach(topic => {
      if (topic.pedagogy && typeof topic.pedagogy === 'object') {
        Object.keys(topic.pedagogy).forEach(pedagogyType => {
          const pedagogySection = topic.pedagogy[pedagogyType];
          if (pedagogySection && typeof pedagogySection === 'object') {

            // Initialize summary structure
            if (!exerciseSummary[pedagogyType]) {
              exerciseSummary[pedagogyType] = {};
            }

            Object.keys(pedagogySection).forEach(category => {
              const exercises = pedagogySection[category];
              if (Array.isArray(exercises)) {

                // Initialize category array in summary
                if (!exerciseSummary[pedagogyType][category]) {
                  exerciseSummary[pedagogyType][category] = [];
                }

                exercises.forEach((exercise, index) => {
                  if (!exercise) return;

                  // Find student's answer for this exercise
                  const exerciseAnswers = answers[pedagogyType]?.[category] || [];
                  const studentAnswer = exerciseAnswers.find(a =>
                    a.exerciseId === exercise.exerciseId
                  );

                  const questions = studentAnswer?.questions || exercise.questions || [];
                  const completedQuestions = questions.filter(q =>
                    q.status === 'attempted' || q.status === 'evaluated' || q.submittedAt
                  ).length;

                  const exerciseData = {
                    type: pedagogyType,
                    category: category,
                    exerciseId: exercise.exerciseId || `${pedagogyType}-${category}-${index + 1}`,
                    exerciseName: exercise.exerciseInformation?.exerciseName ||
                      `${pedagogyType} ${category} ${index + 1}`,
                    status: questions.some(q => q.status === 'evaluated') ? 'evaluated' :
                      questions.some(q => q.status === 'attempted') ? 'attempted' : 'not_started',
                    completedQuestions,
                    totalQuestions: questions.length || 0,
                    score: studentAnswer?.score || exercise.score || 0,
                    maxScore: studentAnswer?.maxScore || exercise.maxScore || 0,
                    lastAttempt: studentAnswer?.lastAttempt || exercise.lastAttempt,
                    attempts: studentAnswer?.attempts || exercise.attempts || 0,
                    submissionDate: studentAnswer?.submittedAt || exercise.submittedAt,
                    evaluated: studentAnswer?.evaluated || exercise.evaluated || false,
                    metadata: {
                      topicTitle: topic.title,
                      exerciseInfo: exercise.exerciseInformation || {}
                    }
                  };

                  allExercises.push(exerciseData);
                  exerciseSummary[pedagogyType][category].push(exerciseData);
                });
              }
            });
          }
        });
      }
    });

    // Calculate overall progress
    const totalExercises = allExercises.length;
    const completedExercises = allExercises.filter(e =>
      e.status === 'evaluated' || e.completedQuestions > 0
    ).length;

    const overallProgress = totalExercises > 0
      ? Math.round((completedExercises / totalExercises) * 100)
      : 0;

    // Calculate average score
    const scoredExercises = allExercises.filter(e => e.score > 0);
    const averageScore = scoredExercises.length > 0
      ? Math.round(scoredExercises.reduce((sum, e) => sum + e.score, 0) / scoredExercises.length)
      : 0;

    // Generate dynamic statistics
    const categoryStats = {};
    Object.keys(exerciseSummary).forEach(pedagogyType => {
      categoryStats[pedagogyType] = {};
      Object.keys(exerciseSummary[pedagogyType]).forEach(category => {
        const categoryExercises = exerciseSummary[pedagogyType][category];
        const completed = categoryExercises.filter(e => e.status === 'evaluated' || e.completedQuestions > 0).length;

        categoryStats[pedagogyType][category] = {
          total: categoryExercises.length,
          completed: completed,
          percentage: categoryExercises.length > 0 ? Math.round((completed / categoryExercises.length) * 100) : 0,
          averageScore: categoryExercises.length > 0
            ? Math.round(categoryExercises.reduce((sum, e) => sum + e.score, 0) / categoryExercises.length)
            : 0
        };
      });
    });

    res.status(200).json({
      success: true,
      data: {
        course,
        student: {
          _id: student._id,
          firstName: student.firstName,
          lastName: student.lastName,
          email: student.email,
          department: student.department,
          phone: student.phone,
          role: {
            renameRole: student.role?.renameRole,
            originalRole: student.role?.originalRole,
            roleValue: student.role?.roleValue
          }
        },
        progress: {
          overall: overallProgress,
          averageScore,
          totalExercises,
          completedExercises,
          pendingExercises: totalExercises - completedExercises,
          exercises: allExercises,
          categoryStats
        },
        summary: exerciseSummary
      }
    });

  } catch (error) {
    console.error("Error fetching student course progress:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

exports.duplicateCourseHierarchy = async (req, res) => {
  try {
    const {
      duplicateCourseId,
      newCourseId,
      institutionId,
      createdBy,
      duplicate,
      selectedModules,
    } = req.body;

    if (!duplicateCourseId || !newCourseId) {
      return res.status(400).json({
        message: [{ key: "error", value: "Source and target courses are required" }],
      });
    }

    if (!duplicate || !Array.isArray(duplicate) || duplicate.length === 0) {
      return res.status(400).json({
        message: [{ key: "error", value: "Please specify what to duplicate (e.g., ['Module','Topic'])" }],
      });
    }

    // 🔹 ID Maps
    const moduleIdMap = new Map();
    const subModuleIdMap = new Map();
    const topicIdMap = new Map();
    const subTopicIdMap = new Map();

    // 🔹 Step 1: Fetch source modules (all or selected)
    let sourceModules = [];
    if (duplicate.includes("Module")) {
      if (selectedModules && selectedModules.length > 0) {
        sourceModules = await Module1.find({
          courses: duplicateCourseId,
          _id: { $in: selectedModules },
        });
      } else {
        sourceModules = await Module1.find({ courses: duplicateCourseId });
      }
    }

    // 🔹 Step 2: Clone hierarchy dynamically
    for (const mod of sourceModules) {
      // --- get last index for Module in newCourse ---
      const lastModule = await Module1.findOne({ courses: newCourseId })
        .sort({ index: -1 })
        .lean();
      const nextModuleIndex = lastModule ? lastModule.index + 1 : 1;

      const newModule = await Module1.create({
        institution: institutionId || mod.institution,
        courses: newCourseId,
        title: mod.title,
        description: mod.description,
        duration: mod.duration,
        index: nextModuleIndex,
        level: mod.level,
        pedagogy: mod.pedagogy, // ✅ carry pedagogy too
        createdBy: createdBy || mod.createdBy,
        updatedBy: createdBy || mod.updatedBy,
      });

      moduleIdMap.set(mod._id.toString(), newModule._id);

      // -------- CASE 2,3,4: Module → SubModule ...
      if (duplicate.includes("SubModule")) {
        const subModules = await SubModule1.find({ moduleId: mod._id });
        for (const sub of subModules) {
          const lastSubModule = await SubModule1.findOne({ moduleId: newModule._id })
            .sort({ index: -1 })
            .lean();
          const nextSubIndex = lastSubModule ? lastSubModule.index + 1 : 1;

          const newSubModule = await SubModule1.create({
            institution: institutionId || sub.institution,
            courses: newCourseId,
            moduleId: newModule._id,
            title: sub.title,
            description: sub.description,
            duration: sub.duration,
            index: nextSubIndex,
            level: sub.level,
            pedagogy: sub.pedagogy,
            createdBy: createdBy || sub.createdBy,
            updatedBy: createdBy || sub.updatedBy,
          });

          subModuleIdMap.set(sub._id.toString(), newSubModule._id);

          if (duplicate.includes("Topic")) {
            const topics = await Topic1.find({ subModuleId: sub._id });
            for (const topic of topics) {
              const lastTopic = await Topic1.findOne({ subModuleId: newSubModule._id })
                .sort({ index: -1 })
                .lean();
              const nextTopicIndex = lastTopic ? lastTopic.index + 1 : 1;

              const newTopic = await Topic1.create({
                institution: institutionId || topic.institution,
                courses: newCourseId,
                moduleId: newModule._id,
                subModuleId: newSubModule._id,
                title: topic.title,
                description: topic.description,
                duration: topic.duration,
                index: nextTopicIndex,
                level: topic.level,
                pedagogy: topic.pedagogy,
                createdBy: createdBy || topic.createdBy,
                updatedBy: createdBy || topic.updatedBy,
              });

              topicIdMap.set(topic._id.toString(), newTopic._id);

              if (duplicate.includes("SubTopic")) {
                const subTopics = await SubTopic1.find({ topicId: topic._id });
                for (const st of subTopics) {
                  const lastSubTopic = await SubTopic1.findOne({ topicId: newTopic._id })
                    .sort({ index: -1 })
                    .lean();
                  const nextSubTopicIndex = lastSubTopic ? lastSubTopic.index + 1 : 1;

                  const newSubTopic = await SubTopic1.create({
                    institution: institutionId || st.institution,
                    courses: newCourseId,
                    topicId: newTopic._id,
                    title: st.title,
                    description: st.description,
                    duration: st.duration,
                    index: nextSubTopicIndex,
                    level: st.level,
                    pedagogy: st.pedagogy,
                    createdBy: createdBy || st.createdBy,
                    updatedBy: createdBy || st.updatedBy,
                  });

                  subTopicIdMap.set(st._id.toString(), newSubTopic._id);
                }
              }
            }
          }
        }
      }

      // -------- CASE 5,6: Module → Topic (no SubModule)
      if (!duplicate.includes("SubModule") && duplicate.includes("Topic")) {
        const topics = await Topic1.find({ moduleId: mod._id });
        for (const topic of topics) {
          const lastTopic = await Topic1.findOne({ moduleId: newModule._id })
            .sort({ index: -1 })
            .lean();
          const nextTopicIndex = lastTopic ? lastTopic.index + 1 : 1;

          const newTopic = await Topic1.create({
            institution: institutionId || topic.institution,
            courses: newCourseId,
            moduleId: newModule._id,
            title: topic.title,
            description: topic.description,
            duration: topic.duration,
            index: nextTopicIndex,
            level: topic.level,
            pedagogy: topic.pedagogy,
            createdBy: createdBy || topic.createdBy,
            updatedBy: createdBy || topic.updatedBy,
          });

          topicIdMap.set(topic._id.toString(), newTopic._id);

          if (duplicate.includes("SubTopic")) {
            const subTopics = await SubTopic1.find({ topicId: topic._id });
            for (const st of subTopics) {
              const lastSubTopic = await SubTopic1.findOne({ topicId: newTopic._id })
                .sort({ index: -1 })
                .lean();
              const nextSubTopicIndex = lastSubTopic ? lastSubTopic.index + 1 : 1;

              const newSubTopic = await SubTopic1.create({
                institution: institutionId || st.institution,
                courses: newCourseId,
                topicId: newTopic._id,
                title: st.title,
                description: st.description,
                duration: st.duration,
                index: nextSubTopicIndex,
                level: st.level,
                pedagogy: st.pedagogy,
                createdBy: createdBy || st.createdBy,
                updatedBy: createdBy || st.updatedBy,
              });

              subTopicIdMap.set(st._id.toString(), newSubTopic._id);
            }
          }
        }
      }
    }

    // 🔹 Step 3: Clone LevelView (same as before, but index already handled above)
    // 🔹 Step 4: Clone PedagogyView (same as before)

    return res.status(200).json({
      message: [{ key: "success", value: "Selected course hierarchy duplicated successfully" }],
      modulesCloned: moduleIdMap.size,
      subModulesCloned: subModuleIdMap.size,
      topicsCloned: topicIdMap.size,
      subTopicsCloned: subTopicIdMap.size,
    });
  } catch (err) {
    console.error("Error duplicating course hierarchy:", err);
    return res.status(500).json({
      message: [{ key: "error", value: "Internal server error" }],
    });
  }
};


const modelMap = {
  modules: { model: Module1, path: "modules" },
  submodules: { model: SubModule1, path: "submodules" },
  topics: { model: Topic1, path: "topics" },
  subtopics: { model: SubTopic1, path: "subtopics" },
};
// ─── getModel helper ──────────────────────────────────────────────────────────
function getModel(type) {
  const map = {
    module:    mongoose.model("Module1"),
    submodule: mongoose.model("SubModule1"),
    topic:     mongoose.model("Topic1"),
    subtopic:  mongoose.model("SubTopic1"),
  };
  return map[type] || null;
}
// Normalize duration
const normalizeDuration = (duration) => {
  if (!duration) return null;
  if (typeof duration === "string" && !isNaN(duration)) {
    return Number(duration);
  }
  return duration;
};



class VideoProcessor {
  static async processVideo(inputBuffer, fileName, targetResolutions = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p']) {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const baseFileName = path.parse(fileName).name;
    const uniqueId = Date.now();
    const inputPath = path.join(tempDir, `input_${uniqueId}_${fileName}`);
    const outputFiles = {};

    try {
      // Write buffer to temporary file
      fs.writeFileSync(inputPath, inputBuffer);

      // Validate input video
      console.log('🔍 Validating input video...');
      const validation = await this.validateVideo(inputPath);
      if (!validation.isValid) {
        console.warn('⚠️ Input video may have compatibility issues');
        console.warn(`   Video codec: ${validation.metadata?.streams?.find(s => s.codec_type === 'video')?.codec_name}`);
        console.warn(`   Audio codec: ${validation.metadata?.streams?.find(s => s.codec_type === 'audio')?.codec_name}`);
      } else {
        console.log('✅ Input video is web-compatible (H.264/AAC)');
      }

      // Get video information
      const videoInfo = await this.getVideoInfo(inputPath);

      console.log(`📊 Original video info: ${videoInfo.width}x${videoInfo.height}, duration: ${videoInfo.duration}s`);

      // Filter resolutions based on original video quality
      const supportedResolutions = this.getSupportedResolutions(videoInfo.width, targetResolutions);
      console.log(`🎯 Target resolutions: ${supportedResolutions.join(', ')}`);

      // Process each supported resolution in parallel
      const processingPromises = supportedResolutions.map(resolution =>
        this.convertResolution(inputPath, baseFileName, resolution, videoInfo, uniqueId)
      );

      // Always add base/original version
      console.log('📦 Adding base version to processing queue...');
      processingPromises.push(this.saveBaseVersion(inputPath, baseFileName, uniqueId));

      // Wait for all conversions to complete
      const results = await Promise.allSettled(processingPromises);

      // Combine successful results
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          outputFiles[result.value.resolution] = result.value;
          console.log(`✅ Successfully processed: ${result.value.resolution}`);
        } else if (result.status === 'rejected') {
          console.error(`❌ Failed to process resolution:`, result.reason?.message || result.reason);
        }
      });

      console.log(`🎉 Video processing complete! Generated ${Object.keys(outputFiles).length} versions`);
      return outputFiles;

    } catch (error) {
      console.error('❌ Critical error in video processing:', error);
      throw error;
    } finally {
      // Cleanup temporary input file with retry logic
      await this.safeDeleteFile(inputPath);
    }
  }

  static getSupportedResolutions(originalWidth, targetResolutions) {
    const resolutionMap = {
      '2160p': 3840,
      '1440p': 2560,
      '1080p': 1920,
      '720p': 1280,
      '480p': 854,
      '360p': 640,
      '240p': 426
    };

    return targetResolutions.filter(resolution => {
      const targetWidth = resolutionMap[resolution];
      return targetWidth && originalWidth >= targetWidth;
    });
  }

  static getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) return reject(err);

        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        if (!videoStream) {
          return reject(new Error('No video stream found'));
        }

        resolve({
          width: videoStream.width,
          height: videoStream.height,
          duration: metadata.format.duration,
          bitrate: metadata.format.bit_rate,
          codec: videoStream.codec_name,
          audioCodec: metadata.streams.find(s => s.codec_type === 'audio')?.codec_name
        });
      });
    });
  }

  static convertResolution(inputPath, baseFileName, resolution, originalInfo, uniqueId) {
    return new Promise((resolve, reject) => {
      const resolutionMap = {
        '2160p': 3840,
        '1440p': 2560,
        '1080p': 1920,
        '720p': 1280,
        '480p': 854,
        '360p': 640,
        '240p': 426
      };

      const targetWidth = resolutionMap[resolution];
      const outputFileName = `${baseFileName}_${resolution}_${uniqueId}.mp4`;
      const outputPath = path.join(path.dirname(inputPath), outputFileName);

      console.log(`🔄 Converting to ${resolution} (${targetWidth}px width)...`);

      const command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .size(`${targetWidth}x?`)
        .videoBitrate('800k')
        .audioCodec('aac')
        .audioBitrate('128k')
        .outputOptions([
          '-preset fast',
          '-crf 23',
          '-movflags +faststart',
          '-pix_fmt yuv420p'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`🚀 Started ${resolution}: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⏳ ${resolution}: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', async () => {
          console.log(`✅ ${resolution} conversion completed`);
          try {
            const outputBuffer = fs.readFileSync(outputPath);
            await this.safeDeleteFile(outputPath);
            resolve({
              resolution,
              buffer: outputBuffer,
              fileName: outputFileName,
              width: targetWidth
            });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', async (err) => {
          console.error(`❌ ${resolution} conversion failed:`, err.message);
          await this.safeDeleteFile(outputPath);
          reject(err);
        });

      command.run();
    });
  }

  static saveBaseVersion(inputPath, baseFileName, uniqueId) {
    return new Promise((resolve, reject) => {
      const outputFileName = `${baseFileName}_base_${uniqueId}.mp4`;
      const outputPath = path.join(path.dirname(inputPath), outputFileName);

      console.log('💾 Saving base version with web optimization...');

      ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-preset fast',
          '-crf 23',
          '-movflags +faststart',
          '-pix_fmt yuv420p'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`🚀 Started base version: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⏳ Base version: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', async () => {
          console.log('✅ Base version saved and optimized');
          try {
            const outputBuffer = fs.readFileSync(outputPath);
            await this.safeDeleteFile(outputPath);
            resolve({
              resolution: 'base',
              buffer: outputBuffer,
              fileName: outputFileName
            });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', async (err) => {
          console.error('❌ Base version failed:', err.message);
          await this.safeDeleteFile(outputPath);
          reject(err);
        })
        .run();
    });
  }

  static async validateVideo(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        console.log('📊 Video validation:', {
          videoCodec: videoStream?.codec_name,
          audioCodec: audioStream?.codec_name,
          duration: metadata.format.duration,
          size: metadata.format.size
        });

        resolve({
          isValid: videoStream?.codec_name === 'h264' && audioStream?.codec_name === 'aac',
          metadata
        });
      });
    });
  }

  static async safeDeleteFile(filePath, maxRetries = 5) {
    if (!fs.existsSync(filePath)) return;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted: ${path.basename(filePath)}`);
        return;
      } catch (error) {
        if (error.code === 'EBUSY' && attempt < maxRetries) {
          console.log(`⚠️ File busy, retrying (${attempt}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        } else {
          console.warn(`⚠️ Could not delete ${filePath}:`, error.message);
          return;
        }
      }
    }
  }
}

const findOrCreateFolder = (folders, pathParts) => {
  if (!Array.isArray(folders)) {
    folders = [];
  }

  if (pathParts.length === 0) {
    return { folders, targetFolder: null };
  }

  const [current, ...rest] = pathParts;
  let folder = folders.find((f) => f.name === current);

  if (!folder) {
    console.log(`📁 Creating new folder: ${current}`);
    folder = {
      _id: new mongoose.Types.ObjectId(),
      name: current,
      files: [],
      subfolders: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    folders.push(folder);
  }

  // Ensure arrays exist
  if (!Array.isArray(folder.files)) folder.files = [];
  if (!Array.isArray(folder.subfolders)) folder.subfolders = [];

  if (rest.length > 0) {
    return findOrCreateFolder(folder.subfolders, rest);
  }

  return { folders: folder.subfolders, targetFolder: folder };
};
const findFolderByPathForNav = (folders, pathParts) => {
  if (!Array.isArray(folders) || pathParts.length === 0) {
    return { folders: [], targetFolder: null };
  }

  const [current, ...rest] = pathParts;
  const folder = folders.find((f) => f.name === current);

  if (!folder) return { folders: [], targetFolder: null };

  if (rest.length === 0) {
    return {
      folders: Array.isArray(folder.subfolders) ? folder.subfolders : [],
      files: Array.isArray(folder.files) ? folder.files : [],
      targetFolder: folder
    };
  }

  if (!Array.isArray(folder.subfolders)) {
    return { folders: [], targetFolder: null };
  }

  return findFolderByPathForNav(folder.subfolders, rest);
};

const findFolderByPath = (folders, pathParts) => {
  if (!Array.isArray(folders)) {
    return null;
  }

  if (pathParts.length === 0) return { folders };

  const [current, ...rest] = pathParts;
  const folder = folders.find((f) => f.name === current);

  if (!folder) return null;
  if (rest.length === 0) return { parent: folders, folder, index: folders.indexOf(folder) };

  if (!Array.isArray(folder.subfolders)) {
    return null;
  }

  return findFolderByPath(folder.subfolders, rest);
};

const findFileById = (pedagogyElement, fileId) => {
  const filesArray = Array.isArray(pedagogyElement.files) ? pedagogyElement.files : [];

  const rootFile = filesArray.find(f => f._id && f._id.toString() === fileId);
  if (rootFile) {
    return { parent: filesArray, file: rootFile, index: filesArray.indexOf(rootFile) };
  }

  const searchInFolders = (folders) => {
    if (!Array.isArray(folders)) {
      return null;
    }

    for (let folder of folders) {
      const folderFiles = Array.isArray(folder.files) ? folder.files : [];
      const fileInFolder = folderFiles.find(f => f._id && f._id.toString() === fileId);

      if (fileInFolder) {
        return { parent: folderFiles, file: fileInFolder, index: folderFiles.indexOf(fileInFolder) };
      }

      const result = searchInFolders(folder.subfolders);
      if (result) return result;
    }
    return null;
  };

  const foldersArray = Array.isArray(pedagogyElement.folders) ? pedagogyElement.folders : [];
  return searchInFolders(foldersArray);
};

// Upload Original Video (Fallback)
const uploadOriginalVideo = async (file, type, section, name, pathParts, targetFolder, isUpdate, updateFileId, pedagogyElement, supabase) => {
  const uniqueFileName = `${Date.now()}_${file.name}`;
  const storageFolderPath = pathParts.length > 0 ? pathParts.join('/') : "root";

  // Store in resolutions/base folder
  const storagePath = `courses/${type}s/${section}/${name}/${storageFolderPath}/resolutions/base/${uniqueFileName}`;

  const { error: uploadError } = await supabase.storage
    .from("smartlms")
    .upload(storagePath, file.data, { contentType: file.mimetype });

  if (uploadError) throw uploadError;

  const fileUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/${storagePath}`;
  const fileUrlMap = new Map();
  fileUrlMap.set('base', fileUrl);

  const newFile = {
    _id: new mongoose.Types.ObjectId(),
    fileName: file.name,
    fileType: file.mimetype,
    fileUrl: fileUrlMap,
    size: file.size.toString(),
    uploadedAt: new Date(),
    isVideo: true,
    availableResolutions: ['base'],
  };

  if (isUpdate && updateFileId) {
    const fileResult = findFileById(pedagogyElement, updateFileId);
    if (fileResult && Array.isArray(fileResult.parent)) {
      fileResult.parent[fileResult.index] = {
        ...fileResult.parent[fileResult.index],
        ...newFile,
        updatedAt: new Date(),
      };
    }
  } else {
    targetFolder.files.push(newFile);
  }
};

// Upload to Resolution Specific Folder
const uploadToResolutionFolder = async (fileBuffer, fileName, resolution, type, section, name, pathParts) => {
  const storageFolderPath = pathParts.length > 0 ? pathParts.join('/') : "root";

  // Store in resolutions/{resolution} folder
  const storagePath = `courses/${type}s/${section}/${name}/${storageFolderPath}/resolutions/${resolution}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("smartlms")
    .upload(storagePath, fileBuffer, {
      contentType: 'video/mp4',
      upsert: true
    });

  if (uploadError) {
    throw new Error(`Failed to upload ${resolution} version: ${uploadError.message}`);
  }

  return `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/${storagePath}`;
};

// Delete from Resolution Folder
const deleteFromResolutionFolder = async (fileUrl, type, section, name, pathParts) => {
  try {
    // Extract the path after "smartlms/" to get the storage path
    const storagePath = fileUrl.split('/storage/v1/object/public/smartlms/')[1];

    if (storagePath) {
      const { error: deleteError } = await supabase.storage
        .from("smartlms")
        .remove([storagePath]);

      if (deleteError) {
        console.warn(`Failed to delete file from storage: ${deleteError.message}`);
      } else {
        console.log(`✅ Deleted file from storage: ${storagePath}`);
      }
    }
  } catch (error) {
    console.warn('Error deleting file from storage:', error);
  }
};

// Debug Folder Structure
const debugFolderStructure = (folders, depth = 0) => {
  const indent = '  '.repeat(depth);
  folders.forEach(folder => {
    console.log(`${indent}📁 ${folder.name} (${folder.files ? folder.files.length : 0} files)`);
    if (folder.files && folder.files.length > 0) {
      folder.files.forEach(file => {
        console.log(`${indent}  📄 ${file.fileName}${file.isVideo ? ' 🎬' : ''}`);
      });
    }
    if (folder.subfolders && folder.subfolders.length > 0) {
      debugFolderStructure(folder.subfolders, depth + 1);
    }
  });
};

function extractFileNameFromUrl(url) {
  try {
    const decoded = decodeURIComponent(url);
    return decoded.split('/').pop().split('?')[0] || "external_link";
  } catch {
    return "external_link";
  }
}

exports.updateEntity = async (req, res) => {
  try {
    const { type, id } = req.params;

    if (!modelMap[type]) {
      return res.status(400).json({ message: [{ key: "error", value: "Invalid entity type" }] });
    }

    const { model } = modelMap[type];
    const entity = await model.findById(id);
    if (!entity) {
      return res.status(404).json({ message: [{ key: "error", value: `${type} not found` }] });
    }

    // Parse body fields
    const {
      courses,
      moduleId,
      subModuleId,
      topicId,
      index,
      title,
      description,
      duration,
      level,
      pedagogy,
      tabType,
      subcategory,
      folderPath,
      folderName,
      isUpdate,
      updateFileId,
      action,
      showToStudents,
      allowDownload,
      selectedFileType,
      fileDescription,
      tags,
      groupId,
      groupName,
      parentGroupId,
      groupDescription,
    } = req.body;

    // Update simple fields
    if (courses) entity.courses = courses;
    if (moduleId) entity.moduleId = moduleId;
    if (subModuleId) entity.subModuleId = subModuleId;
    if (topicId) entity.topicId = topicId;
    if (index !== undefined) entity.index = index;
    if (title) entity.title = title;
    if (description) entity.description = description;
    if (duration) entity.duration = normalizeDuration(duration);
    if (level) entity.level = level;

    // Initialize pedagogy if not exists
    if (!entity.pedagogy) {
      entity.pedagogy = { I_Do: new Map(), We_Do: new Map(), You_Do: new Map() };
    }

    const section = tabType;
    const name = subcategory;

    if (!entity.pedagogy[section]) entity.pedagogy[section] = new Map();

    if (!entity.pedagogy[section].get(name)) {
      entity.pedagogy[section].set(name, {
        description: "",
        files: [],
        folders: [],
        pages: []
      });
    }

    const pedagogyElement = entity.pedagogy[section].get(name);

    // Ensure arrays exist
    if (!Array.isArray(pedagogyElement.files)) {
      pedagogyElement.files = [];
    }
    if (!Array.isArray(pedagogyElement.folders)) {
      pedagogyElement.folders = [];
    }
    if (!Array.isArray(pedagogyElement.pages)) {
      pedagogyElement.pages = [];
    }

    // Parse folder path
    let parsedFolderPath = [];
    if (folderPath) {
      if (Array.isArray(folderPath)) {
        parsedFolderPath = folderPath;
      } else if (typeof folderPath === 'string') {
        try {
          parsedFolderPath = JSON.parse(folderPath);
        } catch (e) {
          parsedFolderPath = folderPath.split('/').filter(Boolean);
        }
      }
    }

// FILE UPDATE HANDLING
if (isUpdate === 'true' && updateFileId) {
  console.log('📝 Processing file update:', { updateFileId, section, name, folderPath: parsedFolderPath });

  // Check if this is a metadata-only update (no files uploaded)
  const isMetadataOnly = !req.files || !req.files.files;
  
  const searchResult = findFileInPedagogyStructureSafe(pedagogyElement, updateFileId);

  if (!searchResult) {
    console.error('❌ File not found for update:', updateFileId);
    return res.status(404).json({
      message: [{ key: "error", value: "File not found" }]
    });
  }

  const { container, filesArray, file, fileIndex, location, folderPath: fileFolderPath } = searchResult;

  // Get values from request
  const showToStudentsValue = showToStudents === 'true' || showToStudents === true;
  const allowDownloadValue = allowDownload === 'true' || allowDownload === true;
  const fileDescriptionValue = fileDescription || file.fileDescription || "";
  const updateFileName = req.body.updateFileName || file.fileName;

  // Parse tags
  let parsedTags = [];
  if (tags) {
    try {
      let raw = tags;
      while (typeof raw === 'string') {
        raw = JSON.parse(raw);
      }
      parsedTags = Array.isArray(raw) ? raw.map((t) => ({
        tagName: t.tagName || t.name || "",
        tagColor: t.tagColor || t.color || "#3B82F6",
      })) : [];
    } catch (error) {
      console.error("Error parsing tags:", error);
      parsedTags = [];
    }
  }

  // If metadata-only update (no files uploaded)
  if (isMetadataOnly) {
    console.log('📝 Metadata-only update for file:', updateFileId);
    
    // Create updated file WITHOUT spreading to avoid circular references
    const updatedFile = {
      _id: file._id,
      fileName: updateFileName || file.fileName,
      fileType: file.fileType,
      fileUrl: file.fileUrl, // Keep existing file URLs
      size: file.size,
      uploadedAt: file.uploadedAt,
      updatedAt: new Date(),
      isVideo: file.isVideo || false,
      availableResolutions: file.availableResolutions || [],
      fileDescription: fileDescriptionValue,
      tags: parsedTags.length > 0 ? parsedTags : (file.tags || []),
      fileSettings: {
        showToStudents: showToStudentsValue,
        allowDownload: allowDownloadValue,
        lastModified: new Date()
      },
      isReference: file.isReference || false
    };

    // Add optional fields if they exist
    if (file.mcqQuestions) updatedFile.mcqQuestions = file.mcqQuestions;

    filesArray[fileIndex] = updatedFile;

    if (location === 'folder') {
      entity.markModified(`pedagogy.${section}.${name}.folders`);
    } else {
      entity.markModified(`pedagogy.${section}.${name}.files`);
    }

    entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
    entity.updatedAt = new Date();

    const savedEntity = await entity.save();

    console.log('✅ File metadata updated successfully:', updateFileId);

    return res.status(200).json({
      message: [{ key: "success", value: "File metadata updated successfully" }],
      data: savedEntity,
    });
  }

  // If files are uploaded, proceed with file content update
  if (req.files && req.files.files) {
    const files = Array.isArray(req.files.files) ? req.files.files : [req.files.files];
    const fileToUpdate = files[0];
    
    console.log(`🔄 Updating file content: ${fileToUpdate.name}`);

    const isVideo = fileToUpdate.mimetype && fileToUpdate.mimetype.startsWith('video/');

    try {
      if (isVideo) {
        const targetResolutions = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'];

        const processedVersions = await VideoProcessor.processVideo(
          fileToUpdate.data,
          fileToUpdate.name,
          targetResolutions
        );

        // Delete old files
        if (file.fileUrl instanceof Map) {
          for (const [resolution, oldFileUrl] of file.fileUrl) {
            try {
              await deleteFromResolutionFolder(oldFileUrl, type, section, name, fileFolderPath);
            } catch (delError) {
              console.warn(`⚠️ Could not delete old ${resolution}:`, delError.message);
            }
          }
        }

        const fileUrlMap = new Map();
        const availableResolutions = [];

        for (const [resolution, processedFile] of Object.entries(processedVersions)) {
          if (processedFile && processedFile.buffer) {
            try {
              const uploadPath = parsedFolderPath.length > 0 ? parsedFolderPath : fileFolderPath;
              const fileUrl = await uploadToResolutionFolder(
                processedFile.buffer,
                processedFile.fileName,
                resolution,
                type,
                section,
                name,
                uploadPath
              );

              fileUrlMap.set(resolution, fileUrl);
              availableResolutions.push(resolution);
            } catch (uploadError) {
              console.error(`Failed to upload ${resolution}:`, uploadError.message);
            }
          }
        }

        const updatedFile = {
          _id: file._id,
          fileName: fileToUpdate.name,
          fileType: fileToUpdate.mimetype,
          fileUrl: fileUrlMap,
          size: fileToUpdate.size.toString(),
          uploadedAt: new Date(),
          updatedAt: new Date(),
          isVideo: true,
          availableResolutions: availableResolutions.sort((a, b) => {
            const order = { '2160p': 7, '1440p': 6, '1080p': 5, '720p': 4, '480p': 3, '360p': 2, '240p': 1, 'base': 0 };
            return (order[b] || 0) - (order[a] || 0);
          }),
          fileDescription: fileDescriptionValue,
          tags: parsedTags.length > 0 ? parsedTags : (file.tags || []),
          fileSettings: {
            showToStudents: showToStudentsValue,
            allowDownload: allowDownloadValue,
            lastModified: new Date()
          },
          isReference: file.isReference || false
        };

        filesArray[fileIndex] = updatedFile;

      } else {
        // Derive correct extension from MIME type so .docx never lands as .ocx
        const UPDATE_MIME_TO_EXT = {
          'application/pdf': '.pdf',
          'application/msword': '.doc',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
          'application/vnd.ms-powerpoint': '.ppt',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
          'application/vnd.ms-excel': '.xls',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
          'application/zip': '.zip',
          'application/x-zip-compressed': '.zip',
          'image/jpeg': '.jpg',
          'image/png': '.png',
          'image/gif': '.gif',
          'image/webp': '.webp',
          'image/svg+xml': '.svg',
          'text/plain': '.txt',
          'text/html': '.html',
        };
        const rawUpdExt = (fileToUpdate.name || '').includes('.') ? '.' + (fileToUpdate.name || '').split('.').pop() : '';
        const correctUpdExt = UPDATE_MIME_TO_EXT[fileToUpdate.mimetype] || rawUpdExt || '';
        const rawUpdStem = (fileToUpdate.name || 'upload').replace(/(\.[^.]+)+$/, '');
        const cleanUpdStem = rawUpdStem.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').slice(0, 120);
        const cleanUpdName = cleanUpdStem + correctUpdExt;

        const uniqueFileName = `${Date.now()}_${cleanUpdName}`;
        const storageFolderPath = parsedFolderPath.length > 0 ? parsedFolderPath.join('/') : (fileFolderPath.length > 0 ? fileFolderPath.join('/') : "root");
        const storagePath = `courses/${type}s/${section}/${name}/${storageFolderPath}/${uniqueFileName}`;

        const { error: uploadError } = await supabase.storage
          .from("smartlms")
          .upload(storagePath, fileToUpdate.data, { contentType: fileToUpdate.mimetype });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        const fileUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/${storagePath}`;
        const fileUrlMap = new Map();
        fileUrlMap.set('base', fileUrl);

        if (file.fileUrl instanceof Map) {
          for (const [resolution, oldFileUrl] of file.fileUrl) {
            await deleteFromResolutionFolder(oldFileUrl, type, section, name, fileFolderPath);
          }
        } else if (file.fileUrl) {
          await deleteFromResolutionFolder(file.fileUrl, type, section, name, fileFolderPath);
        }

        const updatedFile = {
          _id: file._id,
          fileName: cleanUpdName,
          fileType: fileToUpdate.mimetype,
          fileUrl: fileUrlMap,
          size: fileToUpdate.size.toString(),
          uploadedAt: new Date(),
          updatedAt: new Date(),
          isVideo: false,
          fileDescription: fileDescriptionValue,
          tags: parsedTags.length > 0 ? parsedTags : (file.tags || []),
          fileSettings: {
            showToStudents: showToStudentsValue,
            allowDownload: allowDownloadValue,
            lastModified: new Date()
          },
          isReference: file.isReference || false
        };

        filesArray[fileIndex] = updatedFile;
      }

      if (location === 'folder') {
        entity.markModified(`pedagogy.${section}.${name}.folders`);
      } else {
        entity.markModified(`pedagogy.${section}.${name}.files`);
      }

      entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
      entity.updatedAt = new Date();

      const savedEntity = await entity.save();

      console.log('✅ File content and metadata updated successfully:', updateFileId);

      return res.status(200).json({
        message: [{ key: "success", value: "File updated successfully" }],
        data: savedEntity,
      });

    } catch (processError) {
      console.error('Error during file update:', processError);
      return res.status(500).json({
        message: [{ key: "error", value: "Failed to process file update: " + processError.message }]
      });
    }
  }
  
  // If we get here, something is wrong
  return res.status(400).json({
    message: [{ key: "error", value: "Invalid update request" }]
  });
}
    // FOLDER CREATION
    if (action === 'createFolder' && folderName) {
      const pathParts = folderPath ? (Array.isArray(folderPath) ? folderPath : folderPath.split("/").filter(p => p)) : [];

      if (!Array.isArray(pedagogyElement.folders)) {
        pedagogyElement.folders = [];
      }

      let targetFolders = pedagogyElement.folders;

      if (pathParts.length > 0) {
        for (const pathPart of pathParts) {
          let foundFolder = targetFolders.find(f => f.name === pathPart);

          if (!foundFolder) {
            return res.status(404).json({
              message: [{ key: "error", value: `Parent folder '${pathPart}' not found` }]
            });
          }

          if (!Array.isArray(foundFolder.subfolders)) {
            foundFolder.subfolders = [];
          }

          targetFolders = foundFolder.subfolders;
        }
      }

      // Scope uniqueness check per group:
      // – grouped folder  → only conflict with folders that share the same parentGroupId
      // – standalone folder → only conflict with other ungrouped folders (no parentGroupId)
      const existingFolder = targetFolders.find(f => {
        if (f.name !== folderName) return false;
        if (parentGroupId) return f.parentGroupId === parentGroupId;
        return !f.parentGroupId;
      });
      if (existingFolder) {
        return res.status(400).json({
          message: [{ key: "error", value: `Folder '${folderName}' already exists` }]
        });
      }

      let parsedTags = [];
      if (tags) {
        try {
          let raw = tags;
          while (typeof raw === 'string') {
            raw = JSON.parse(raw);
          }
          parsedTags = Array.isArray(raw) ? raw.filter(t => t.tagName && t.tagName.trim()).map((t) => ({
            tagName:  t.tagName  || t.name  || "",
            tagColor: t.tagColor || t.color || "#3B82F6",
          })) : [];
        } catch (error) {
          console.error("Error parsing tags:", error);
          parsedTags = [];
        }
      }

      const newFolder = {
        _id: new mongoose.Types.ObjectId(),
        name: folderName,
        files: [],
        subfolders: [],
        tags: parsedTags,
        pages: [],
        uploadedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(parentGroupId ? { parentGroupId } : {}),
        ...(groupName ? { groupName } : {}),
        ...(groupDescription ? { groupDescription } : {}),
      };

      targetFolders.push(newFolder);

      entity.markModified(`pedagogy.${section}.${name}.folders`);
      entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
      entity.updatedAt = new Date();

      const updatedEntity = await entity.save();

      return res.status(200).json({
        message: [{ key: "success", value: `Folder '${folderName}' created successfully` }],
        data: updatedEntity,
      });
    }

    // FOLDER UPDATE
   // FOLDER UPDATE
if (action === 'updateFolder' && folderName) {
  const pathParts = folderPath ? (Array.isArray(folderPath) ? folderPath : folderPath.split("/").filter(p => p)) : [];
  const originalFolderName = req.body.originalFolderName;

  if (!originalFolderName) {
    return res.status(400).json({
      message: [{ key: "error", value: "originalFolderName is required for folder update" }]
    });
  }

  // Parse tags for folder update
  let parsedTags = [];
  const tagsRaw = req.body.tags;
  
  console.log('📝 Raw tags value for folder update:', tagsRaw, 'Type:', typeof tagsRaw);

  if (tagsRaw) {
    try {
      let tagsData = tagsRaw;
      if (typeof tagsRaw === 'string') {
        tagsData = JSON.parse(tagsRaw);
      }

      if (Array.isArray(tagsData)) {
        parsedTags = tagsData
          .map(tag => {
            if (typeof tag === 'object') {
              return {
                tagName: tag.tagName || tag.name || "",
                tagColor: tag.tagColor || tag.color || "#3B82F6",
              };
            } else if (typeof tag === 'string') {
              return {
                tagName: tag,
                tagColor: "#3B82F6",
              };
            }
            return null;
          })
          .filter(tag => tag && tag.tagName && tag.tagName.trim() !== "");
      }

      console.log('✅ Parsed tags for folder update:', parsedTags);
    } catch (error) {
      console.error('❌ Error parsing tags for folder update:', error);

      // Fallback: try to parse as comma-separated string
      if (typeof tagsRaw === 'string' && tagsRaw.includes(',')) {
        parsedTags = tagsRaw.split(',').map(t => ({
          tagName: t.trim(),
          tagColor: "#3B82F6"
        })).filter(t => t.tagName);
      }
    }
  }

  let targetFolders = pedagogyElement.folders;

  if (pathParts.length > 0) {
    for (const pathPart of pathParts) {
      const foundFolder = targetFolders.find(f => f.name === pathPart);
      if (!foundFolder) {
        return res.status(404).json({
          message: [{ key: "error", value: `Parent folder '${pathPart}' not found` }]
        });
      }
      if (!Array.isArray(foundFolder.subfolders)) foundFolder.subfolders = [];
      targetFolders = foundFolder.subfolders;
    }
  }

  const folderToUpdate = targetFolders.find(f => f.name === originalFolderName);
  if (!folderToUpdate) {
    return res.status(404).json({
      message: [{ key: "error", value: `Folder '${originalFolderName}' not found` }]
    });
  }

  // Update folder properties
  folderToUpdate.name = folderName;
  folderToUpdate.updatedAt = new Date();
  
  // ✅ UPDATE TAGS HERE
  if (parsedTags.length > 0) {
    folderToUpdate.tags = parsedTags;
  } else if (tagsRaw === null || tagsRaw === '' || (Array.isArray(tagsRaw) && tagsRaw.length === 0)) {
    // If tags are explicitly cleared, set to empty array
    folderToUpdate.tags = [];
  }

  entity.markModified(`pedagogy.${section}.${name}.folders`);
  entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
  entity.updatedAt = new Date();

  const updatedEntity = await entity.save();

  console.log('✅ Folder updated with tags:', folderToUpdate.tags);

  return res.status(200).json({
    message: [{ key: "success", value: `Folder renamed to '${folderName}' successfully` }],
    data: updatedEntity,
  });
}

    // FOLDER DELETION
    if (action === 'deleteFolder' && folderName) {
      const pathParts = folderPath ? (Array.isArray(folderPath) ? folderPath : folderPath.split("/").filter(p => p)) : [];
      const fullPath = [...pathParts, folderName];

      const result = findFolderByPath(pedagogyElement.folders, fullPath);

      if (!result || !result.parent) {
        return res.status(404).json({
          message: [{ key: "error", value: `Folder '${folderName}' not found` }]
        });
      }

      const deleteFolderFilesRecursively = async (folder, currentPath = []) => {
        const filesArray = Array.isArray(folder.files) ? folder.files : [];

        for (let file of filesArray) {
          try {
            if (file.fileUrl instanceof Map) {
              for (const [resolution, fileUrl] of file.fileUrl) {
                await deleteFromResolutionFolder(fileUrl, type, section, name, currentPath);
              }
            } else if (file.fileUrl) {
              await deleteFromResolutionFolder(file.fileUrl, type, section, name, currentPath);
            }
          } catch (storageError) {
            console.warn("Storage deletion error:", storageError);
          }
        }

        const subfoldersArray = Array.isArray(folder.subfolders) ? folder.subfolders : [];
        for (let subfolder of subfoldersArray) {
          await deleteFolderFilesRecursively(subfolder, [...currentPath, subfolder.name]);
        }
      };

      await deleteFolderFilesRecursively(result.folder, fullPath);

      if (Array.isArray(result.parent)) {
        result.parent.splice(result.index, 1);
      }

      entity.markModified(`pedagogy.${section}.${name}.folders`);
      entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
      entity.updatedAt = Date.now();

      const updatedEntity = await entity.save();

      return res.status(200).json({
        message: [{ key: "success", value: `Folder '${folderName}' deleted successfully` }],
        data: updatedEntity,
      });
    }

    // FILE DELETION
    if (action === 'deleteFile' && updateFileId) {
      const fileResult = findFileById(pedagogyElement, updateFileId);

      if (!fileResult) {
        return res.status(404).json({
          message: [{ key: "error", value: "File not found" }]
        });
      }

      try {
        const fileUrlMap = fileResult.file.fileUrl;

        if (fileUrlMap instanceof Map) {
          for (const [resolution, fileUrl] of fileUrlMap) {
            await deleteFromResolutionFolder(fileUrl, type, section, name, parsedFolderPath);
          }
        } else if (fileResult.file.fileUrl) {
          await deleteFromResolutionFolder(fileResult.file.fileUrl, type, section, name, parsedFolderPath);
        }
      } catch (storageError) {
        console.warn("Storage deletion error:", storageError);
      }

      if (Array.isArray(fileResult.parent)) {
        fileResult.parent.splice(fileResult.index, 1);
      }

      entity.markModified(`pedagogy.${section}.${name}`);
      entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
      entity.updatedAt = Date.now();

      const updatedEntity = await entity.save();

      return res.status(200).json({
        message: [{ key: "success", value: "File deleted successfully" }],
        data: updatedEntity,
      });
    }

    // NEW FILE UPLOAD
    if (req.files && req.files.files && (!isUpdate || !updateFileId)) {
      const files = Array.isArray(req.files.files) ? req.files.files : [req.files.files];
      const pathParts = parsedFolderPath;

      const showToStudentsValue = showToStudents === 'true' || showToStudents === true;
      const allowDownloadValue = allowDownload === 'true' || allowDownload === true;

      let parsedTags = [];
      const tagsRaw = req.body.tags;

      console.log('📝 Raw tags value:', tagsRaw, 'Type:', typeof tagsRaw);

      if (tagsRaw) {
        try {
          let tagsData = tagsRaw;
          if (typeof tagsRaw === 'string') {
            tagsData = JSON.parse(tagsRaw);
          }

          if (Array.isArray(tagsData)) {
            parsedTags = tagsData
              .map(tag => {
                if (typeof tag === 'object') {
                  return {
                    tagName: tag.tagName || tag.name || "",
                    tagColor: tag.tagColor || tag.color || "#3B82F6",
                  };
                } else if (typeof tag === 'string') {
                  return {
                    tagName: tag,
                    tagColor: "#3B82F6",
                  };
                }
                return null;
              })
              .filter(tag => tag && tag.tagName && tag.tagName.trim() !== "");
          }

          console.log('✅ Parsed tags:', parsedTags);
        } catch (error) {
          console.error('❌ Error parsing tags:', error);

          if (typeof tagsRaw === 'string' && tagsRaw.includes(',')) {
            parsedTags = tagsRaw.split(',').map(t => ({
              tagName: t.trim(),
              tagColor: "#3B82F6"
            })).filter(t => t.tagName);
          }
        }
      }

      let targetFolder = pedagogyElement;

      if (pathParts.length > 0) {
        let currentFolders = pedagogyElement.folders || [];

        for (const folderName of pathParts) {
          const foundFolder = currentFolders.find(f => f.name === folderName);
          if (!foundFolder) {
            return res.status(404).json({
              message: [{ key: "error", value: `Folder '${folderName}' not found` }]
            });
          }
          targetFolder = foundFolder;
          currentFolders = foundFolder.subfolders || [];
        }
      }

      if (!Array.isArray(targetFolder.files)) {
        targetFolder.files = [];
      }

      for (let file of files) {
        const isVideo = file.mimetype && file.mimetype.startsWith('video/');

        if (isVideo) {
          console.log(`🎬 Processing video: ${file.name} (${file.size} bytes)`);

          try {
            const targetResolutions = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'];

            const processedVersions = await VideoProcessor.processVideo(
              file.data,
              file.name,
              targetResolutions
            );

            const fileUrlMap = new Map();
            const availableResolutions = [];

            for (const [resolution, processedFile] of Object.entries(processedVersions)) {
              if (processedFile && processedFile.buffer) {
                try {
                  // ── FIX 1: use uploadToResolutionFolder helper ──────────────
                  const fileUrl = await uploadToResolutionFolder(
                    processedFile.buffer,
                    processedFile.fileName,
                    resolution,
                    type,
                    section,
                    name,
                    pathParts
                  );
                  fileUrlMap.set(resolution, fileUrl);
                  availableResolutions.push(resolution);
                  console.log(`✅ Uploaded ${resolution}: ${fileUrl}`);
                } catch (uploadErr) {
                  console.error(`❌ Upload error for ${resolution}:`, uploadErr.message);
                }
              }
            }

            // ── FIX 2: use uploadOriginalVideo fallback ─────────────────────
            if (fileUrlMap.size === 0) {
              console.warn('⚠️ No processed versions succeeded, falling back to original');
              try {
                await uploadOriginalVideo(
                  file,
                  type,
                  section,
                  name,
                  pathParts,
                  targetFolder,
                  false,
                  null,
                  pedagogyElement,
                  supabase
                );
                console.log('✅ Fallback original video uploaded');
                continue; // uploadOriginalVideo already pushed to targetFolder.files
              } catch (fallbackErr) {
                console.error('❌ Fallback upload also failed:', fallbackErr.message);
                continue;
              }
            }

            const newFile = {
              _id: new mongoose.Types.ObjectId(),
              fileName: file.name,
              fileType: file.mimetype,
              fileUrl: fileUrlMap,
              size: file.size.toString(),
              uploadedAt: new Date(),
              isVideo: true,
                isReference: selectedFileType === "reference" ? true : false,

              // ── FIX 3: sort resolutions best-first ─────────────────────────
              availableResolutions: availableResolutions.sort((a, b) => {
                const order = { '2160p': 7, '1440p': 6, '1080p': 5, '720p': 4, '480p': 3, '360p': 2, '240p': 1, 'base': 0 };
                return (order[b] || 0) - (order[a] || 0);
              }),
              fileDescription: fileDescription || "",
              tags: parsedTags,
              groupId: groupId || "",
              groupName: groupName || "",
              parentGroupId: parentGroupId || "",
              fileSettings: {
                showToStudents: showToStudentsValue,
                allowDownload: allowDownloadValue,
                lastModified: new Date(),
              },
            };

            targetFolder.files.push(newFile);
            console.log(`✅ Video saved with ${availableResolutions.length} resolution(s):`, availableResolutions);

          } catch (videoErr) {
            console.error('❌ Video processing failed entirely:', videoErr.message);
            continue;
          }

        } else {
          // Non-video upload
          // ── Derive the correct extension from MIME type so filenames like
          // "file.docx.docx" or "file.ocx" (Windows docx mangling) are fixed.
          const MIME_TO_EXT = {
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'application/vnd.ms-excel': '.xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
            'application/vnd.ms-powerpoint': '.ppt',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
            'text/plain': '.txt',
            'text/csv': '.csv',
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
            'application/zip': '.zip',
            'application/x-zip-compressed': '.zip',
          };
          // Fallback: take extension from original filename (strip double extensions)
          const rawOrigExt = (file.name || '').includes('.')
            ? '.' + (file.name || '').split('.').pop()
            : '';
          const correctExt = MIME_TO_EXT[file.mimetype] || rawOrigExt || '';
          // Build a clean stem (strip ALL extensions from the original name)
          const rawStem = (file.name || 'upload').replace(/(\.[^.]+)+$/, '');
          const cleanStem = rawStem.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').slice(0, 120);
          const cleanName = cleanStem + correctExt;
          const uniqueFileName = `${Date.now()}_${cleanName}`;
          const storageFolderPath = pathParts.length > 0 ? pathParts.join('/') : "root";
          const storagePath = `courses/${type}s/${section}/${name}/${storageFolderPath}/${uniqueFileName}`;

          const { error: uploadError } = await supabase.storage
            .from("smartlms")
            .upload(storagePath, file.data, { contentType: file.mimetype });

          if (uploadError) {
            console.error("File upload error:", uploadError);
            continue;
          }

          const fileUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/${storagePath}`;
          const fileUrlMap = new Map();
          fileUrlMap.set('base', fileUrl);

          const newFile = {
            _id: new mongoose.Types.ObjectId(),
            fileName: cleanName,          // use the sanitised name with correct extension
            fileType: file.mimetype,
            fileUrl: fileUrlMap,
            size: file.size.toString(),
            uploadedAt: new Date(),
            isVideo: false,
            isReference: selectedFileType === "reference" ? true : false,
            fileDescription: fileDescription || "",
            tags: parsedTags,
            groupId: groupId || "",
            groupName: groupName || "",
            parentGroupId: parentGroupId || "",
            fileSettings: {
              showToStudents: showToStudentsValue,
              allowDownload: allowDownloadValue,
              lastModified: new Date()
            }
          };

          targetFolder.files.push(newFile);
          console.log('📁 Added file:', cleanName, 'mime:', file.mimetype);
        }
      }

      // CRITICAL: Mark the correct path as modified
      if (pathParts.length > 0) {
        entity.markModified(`pedagogy.${section}.${name}.folders`);
      } else {
        entity.markModified(`pedagogy.${section}.${name}.files`);
      }

      entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
      entity.updatedAt = new Date();

      const savedEntity = await entity.save();

      console.log('💾 Saved entity, checking tags in saved file:');
      const savedFiles = pathParts.length > 0
        ? savedEntity.pedagogy[section].get(name).folders
        : savedEntity.pedagogy[section].get(name).files;
      console.log('Saved files with tags:', JSON.stringify(savedFiles, null, 2));

      return res.status(200).json({
        message: [{ key: "success", value: "Files uploaded successfully" }],
        data: savedEntity,
      });
    }

    // URL LINK HANDLING
    if (req.body.fileUrl && !req.files) {
      const { fileUrl, fileName, fileType } = req.body;

      if (!fileUrl) {
        return res.status(400).json({
          message: [{ key: "error", value: "File URL is required" }]
        });
      }

      const showToStudentsValue = showToStudents === 'true' || showToStudents === true;
      const allowDownloadValue = allowDownload === 'true' || allowDownload === true;

      let parsedTags = [];
      if (tags) {
        try {
          let raw = tags;
          while (typeof raw === 'string') {
            raw = JSON.parse(raw);
          }
          parsedTags = Array.isArray(raw) ? raw.map((t) => ({
            tagName:  t.tagName  || t.name  || "",
            tagColor: t.tagColor || t.color || "#3B82F6",
          })) : [];
        } catch (error) {
          console.error("Error parsing tags:", error);
          parsedTags = [];
        }
      }

      const pathParts = parsedFolderPath;
      let targetFolder = pedagogyElement;

      if (pathParts.length > 0) {
        let currentFolders = pedagogyElement.folders || [];

        for (const folderName of pathParts) {
          const foundFolder = currentFolders.find(f => f.name === folderName);
          if (!foundFolder) {
            return res.status(404).json({
              message: [{ key: "error", value: `Folder '${folderName}' not found` }]
            });
          }
          targetFolder = foundFolder;
          currentFolders = foundFolder.subfolders || [];
        }
      }

      if (!Array.isArray(targetFolder.files)) {
        targetFolder.files = [];
      }

      const fileUrlMap = new Map();
      fileUrlMap.set("base", fileUrl);

      const newFile = {
        _id: new mongoose.Types.ObjectId(),
        fileName: fileName || extractFileNameFromUrl(fileUrl),
        fileType: fileType || "text/uri-list",
        fileUrl: fileUrlMap,
        size: "0",
        uploadedAt: new Date(),
        isVideo: false,
          isReference: selectedFileType === "reference" ? true : false,

        fileDescription: fileDescription || "",
        tags: parsedTags,
        groupId: groupId || "",
        groupName: groupName || "",
        parentGroupId: parentGroupId || "",
        fileSettings: {
          showToStudents: showToStudentsValue,
          allowDownload: allowDownloadValue,
          lastModified: new Date()
        }
      };

      targetFolder.files.push(newFile);

      entity.markModified(`pedagogy.${section}.${name}`);
      entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
      entity.updatedAt = new Date();

      await entity.save();

      return res.status(200).json({
        message: [{ key: "success", value: "URL added successfully" }],
        data: entity,
      });
    }

    // If no specific action was handled
    entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
    entity.updatedAt = new Date();

    const updatedEntity = await entity.save();

    return res.status(200).json({
      message: [{ key: "success", value: `${type} updated successfully` }],
      data: updatedEntity,
    });

  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({
      message: [{ key: "error", value: "Internal server error: " + err.message }]
    });
  }
};

// Helper function to find file in pedagogy structure
const findFileInPedagogyStructureSafe = (pedagogyElement, fileId) => {
  // Search in root files
  const rootFiles = Array.isArray(pedagogyElement.files) ? pedagogyElement.files : [];
  const rootFileIndex = rootFiles.findIndex(f => f._id && f._id.toString() === fileId);
  
  if (rootFileIndex !== -1) {
    return {
      container: pedagogyElement,
      filesArray: rootFiles,
      file: rootFiles[rootFileIndex],
      fileIndex: rootFileIndex,
      location: 'root',
      folderPath: []
    };
  }

  // Search in folders recursively
  const searchInFolders = (folders, currentPath = []) => {
    if (!Array.isArray(folders)) return null;
    
    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];
      const folderFiles = Array.isArray(folder.files) ? folder.files : [];
      const fileIndex = folderFiles.findIndex(f => f._id && f._id.toString() === fileId);
      
      if (fileIndex !== -1) {
        return {
          container: folder,
          filesArray: folderFiles,
          file: folderFiles[fileIndex],
          fileIndex: fileIndex,
          location: 'folder',
          folderPath: [...currentPath, folder.name]
        };
      }
      
      const subfolders = Array.isArray(folder.subfolders) ? folder.subfolders : [];
      const found = searchInFolders(subfolders, [...currentPath, folder.name]);
      if (found) return found;
    }
    return null;
  };
  
  const folders = Array.isArray(pedagogyElement.folders) ? pedagogyElement.folders : [];
  return searchInFolders(folders);
};

// Separate endpoint for updating only file settings
exports.updateFileSettings = async (req, res) => {
  try {
    const { type, id } = req.params;
    const {
      tabType,
      subcategory,
      updateFileId,
      showToStudents,
      allowDownload,
      folderPath = ''
    } = req.body;

    if (!modelMap[type]) {
      return res.status(400).json({ message: [{ key: "error", value: "Invalid entity type" }] });
    }

    const { model } = modelMap[type];
    const entity = await model.findById(id);
    if (!entity) {
      return res.status(404).json({ message: [{ key: "error", value: `${type} not found` }] });
    }

    // Initialize pedagogy if not exists
    if (!entity.pedagogy) {
      entity.pedagogy = { I_Do: new Map(), We_Do: new Map(), You_Do: new Map() };
    }

    const section = tabType;
    const name = subcategory;

    if (!entity.pedagogy[section]) entity.pedagogy[section] = new Map();

    if (!entity.pedagogy[section].get(name)) {
      entity.pedagogy[section].set(name, {
        description: "",
        files: [],
        folders: []
      });
    }

    const pedagogyElement = entity.pedagogy[section].get(name);

    // Find the file
    const pathParts = folderPath ? folderPath.split("/").filter(p => p) : [];
    let targetFolder = pedagogyElement;

    if (pathParts.length > 0) {
      let currentFolders = pedagogyElement.folders || [];
      for (const folderName of pathParts) {
        if (!Array.isArray(currentFolders)) {
          currentFolders = [];
        }

        const foundFolder = currentFolders.find(f => f.name === folderName);
        if (!foundFolder) {
          return res.status(404).json({
            message: [{ key: "error", value: `Folder '${folderName}' not found` }]
          });
        }

        targetFolder = foundFolder;
        currentFolders = foundFolder.subfolders || [];
      }
    }

    if (!Array.isArray(targetFolder.files)) {
      targetFolder.files = [];
    }

    const fileIndex = targetFolder.files.findIndex(f => f._id.toString() === updateFileId);
    if (fileIndex === -1) {
      // Also search in root files
      const rootFileIndex = pedagogyElement.files.findIndex(f => f._id.toString() === updateFileId);
      if (rootFileIndex === -1) {
        return res.status(404).json({
          message: [{ key: "error", value: "File not found" }]
        });
      }

      // Update root file settings
      if (!pedagogyElement.files[rootFileIndex].fileSettings) {
        pedagogyElement.files[rootFileIndex].fileSettings = {};
      }

      pedagogyElement.files[rootFileIndex].fileSettings = {
        showToStudents: showToStudents !== undefined ? showToStudents : (pedagogyElement.files[rootFileIndex].fileSettings?.showToStudents),
        allowDownload: allowDownload !== undefined ? allowDownload : (pedagogyElement.files[rootFileIndex].fileSettings?.allowDownload),
        lastModified: new Date()
      };
    } else {
      // Update folder file settings
      if (!targetFolder.files[fileIndex].fileSettings) {
        targetFolder.files[fileIndex].fileSettings = {};
      }

      targetFolder.files[fileIndex].fileSettings = {
        showToStudents: showToStudents !== undefined ? showToStudents : (targetFolder.files[fileIndex].fileSettings?.showToStudents ?? true),
        allowDownload: allowDownload !== undefined ? allowDownload : (targetFolder.files[fileIndex].fileSettings?.allowDownload ?? true),
        lastModified: new Date()
      };
    }

    entity.markModified(`pedagogy.${section}.${name}`);
    entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
    entity.updatedAt = new Date();

    const updatedEntity = await entity.save();

    return res.status(200).json({
      message: [{ key: "success", value: "File settings updated successfully" }],
      data: updatedEntity,
    });
  } catch (err) {
    console.error("Update file settings error:", err);
    res.status(500).json({ message: [{ key: "error", value: "Internal server error" }] });
  }
};




/**
 * Create a new page in a folder or root
 */
// ─── createPage controller ────────────────────────────────────────────────────
// POST /pages/:type/:id/pages

exports.createPage = async (req, res) => {
  try {
    const { type, id } = req.params;

    // ── 1. Destructure body ───────────────────────────────────────────────────
    const {
      pages,          // array of PagePayloadItem (multi-page doc)
      combinedCode,   // combined HTML string for all pages
      combinedHtml,   // alias sent by some frontend versions
      hierarchyInfo,
      tabType,
      subcategory,
      folderPath,
      // Group context — when the resource picker was opened from a group
      // row's "Add" action, the frontend forwards these so the new page
      // can be attached to that group (rendered inside the group row).
      groupId,
      groupName,
    } = req.body;

    // Allow these to be supplied via hierarchyInfo too (the frontend sends
    // them in both places for resilience). req.body wins when explicit.
    const resolvedGroupId = (groupId ?? hierarchyInfo?.groupId) || null;
    const resolvedGroupName = (groupName ?? hierarchyInfo?.groupName) || null;

    // ── 2. Resolve fields defensively — no duplicate const ───────────────────
    const resolvedTitle = req.body.title || pages?.[0]?.name || "Untitled";
    const resolvedBlocks = req.body.blocks || pages?.[0]?.blocks || [];
    const resolvedCombinedCode = combinedCode || combinedHtml || "";

    // ── 3. Validate required fields ───────────────────────────────────────────
    if (!resolvedTitle) {
      return res.status(400).json({
        message: [{ key: "error", value: "Page title is required" }],
      });
    }

    if (!resolvedCombinedCode && resolvedBlocks.length === 0) {
      return res.status(400).json({
        message: [{ key: "error", value: "Page must have content (blocks or HTML)" }],
      });
    }

    if (!tabType || !subcategory) {
      return res.status(400).json({
        message: [{ key: "error", value: "tabType and subcategory are required" }],
      });
    }

    // ── 4. Resolve model ──────────────────────────────────────────────────────
    const modelMap = {
      module: mongoose.model("Module1"),
      submodule: mongoose.model("SubModule1"),
      topic: mongoose.model("Topic1"),
      subtopic: mongoose.model("SubTopic1"),
    };

    const Model = modelMap[type];
    if (!Model) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}` }],
      });
    }

    const entity = await Model.findById(id);
    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} not found` }],
      });
    }

    // ── 5. Ensure pedagogy structure exists ───────────────────────────────────
    if (!entity.pedagogy) {
      entity.pedagogy = { I_Do: new Map(), We_Do: new Map(), You_Do: new Map() };
    }

    if (!entity.pedagogy[tabType]) {
      entity.pedagogy[tabType] = new Map();
    }

    // ── 6. Ensure subcategory element exists ──────────────────────────────────
    const getter = entity.pedagogy[tabType].get
      ? entity.pedagogy[tabType].get(subcategory)
      : entity.pedagogy[tabType][subcategory];

    if (!getter) {
      const emptyElement = { description: "", files: [], folders: [], pages: [] };
      if (entity.pedagogy[tabType].set) {
        entity.pedagogy[tabType].set(subcategory, emptyElement);
      } else {
        entity.pedagogy[tabType][subcategory] = emptyElement;
      }
    }

    const pedagogyElement = entity.pedagogy[tabType].get
      ? entity.pedagogy[tabType].get(subcategory)
      : entity.pedagogy[tabType][subcategory];

    // ── 7. Ensure arrays exist on the pedagogy element ────────────────────────
    if (!Array.isArray(pedagogyElement.files)) pedagogyElement.files = [];
    if (!Array.isArray(pedagogyElement.folders)) pedagogyElement.folders = [];
    if (!Array.isArray(pedagogyElement.pages)) pedagogyElement.pages = [];

    // ── 8. Parse blocks safely ────────────────────────────────────────────────
    const parsedBlocks =
      typeof resolvedBlocks === "string"
        ? JSON.parse(resolvedBlocks)
        : resolvedBlocks;

    // ── 9. Parse pages array safely (multi-page docs) ─────────────────────────
    let parsedPages = [];
    if (pages) {
      parsedPages = typeof pages === "string" ? JSON.parse(pages) : pages;
    }

    // ── 10. Resolve folder path ───────────────────────────────────────────────
    let folderPathArray = [];
    if (Array.isArray(folderPath)) {
      folderPathArray = folderPath;
    } else if (typeof folderPath === "string" && folderPath.trim()) {
      // Support comma-separated OR slash-separated paths
      folderPathArray = folderPath.includes(",")
        ? folderPath.split(",").filter(Boolean)
        : folderPath.split("/").filter(Boolean);
    }

    // ── 11. Navigate to target folder if path provided ────────────────────────
    let targetContainer = pedagogyElement;
    let targetFolderId = null;
    let addedInsideFolder = false;

    if (folderPathArray.length > 0) {
      const result = findOrCreateFolder(pedagogyElement.folders, folderPathArray);
      const targetFolder = result?.targetFolder;

      if (!targetFolder) {
        return res.status(404).json({
          message: [{ key: "error", value: "Failed to create or find folder path" }],
        });
      }

      if (!Array.isArray(targetFolder.pages)) {
        targetFolder.pages = [];
      }

      targetFolderId = targetFolder._id || null;
      targetContainer = targetFolder;
      addedInsideFolder = true;
    }

    // ── 12. Build the page document ───────────────────────────────────────────
    const newPage = {
      _id: new mongoose.Types.ObjectId(),
      title: resolvedTitle,
      blocks: parsedBlocks,
      combinedCode: resolvedCombinedCode,
      // Store each individual page's data for multi-page documents
      pagesData: parsedPages.length > 0 ? parsedPages.map((p) => ({
        id: p.id || p._id || String(new mongoose.Types.ObjectId()),
        name: p.name || p.title || "Untitled",
        html: p.html || "",
        blocks: p.blocks || [],
      })) : undefined,
      isMultiPage: parsedPages.length > 1,
      pageCount: parsedPages.length || 1,
      version: "1.0.0",
      folderId: targetFolderId,
      folderPath: folderPathArray,
      // Group context — null when the page is not part of a group; set to
      // the group's id/name when created from a group row's "Add" action.
      groupId: resolvedGroupId,
      groupName: resolvedGroupName,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: req.user?.email || "system",
      updatedBy: req.user?.email || "system",
    };

    // ── 13. Push into target container ────────────────────────────────────────
    if (!Array.isArray(targetContainer.pages)) {
      targetContainer.pages = [];
    }
    targetContainer.pages.push(newPage);

    // ── 14. Mark modified so Mongoose persists nested change ──────────────────
    if (addedInsideFolder) {
      entity.markModified(`pedagogy.${tabType}.${subcategory}.folders`);
    } else {
      entity.markModified(`pedagogy.${tabType}.${subcategory}.pages`);
    }

    entity.updatedBy = req.user?.email || "system";
    entity.updatedAt = new Date();

    // ── 15. Save ──────────────────────────────────────────────────────────────
    const savedEntity = await entity.save({
      validateModifiedOnly: true,
      validateBeforeSave: true,
    });

    return res.status(200).json({
      success: true,
      message: [{ key: "success", value: "Page created successfully" }],
      data: savedEntity,
      page: newPage,
      location: addedInsideFolder ? "inside_folder" : "root",
      folderPath: folderPathArray,
      folderId: targetFolderId,
      isMultiPage: parsedPages.length > 1,
      pageCount: parsedPages.length || 1,
    });

  } catch (err) {
    console.error("Create page error:", err);

    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: [{ key: "error", value: "Validation error" }],
        errors: err.errors,
      });
    }

    if (err instanceof SyntaxError) {
      return res.status(400).json({
        success: false,
        message: [{ key: "error", value: "Invalid JSON in request body" }],
      });
    }

    return res.status(500).json({
      success: false,
      message: [{ key: "error", value: "Internal server error" }],
    });
  }
};

// Find a page by ID (searches in root and all folders)
const findPageById = (pedagogyElement, pageId) => {
  // Search in root pages
  const rootPages = Array.isArray(pedagogyElement.pages) ? pedagogyElement.pages : [];
  const rootPage = rootPages.find(p => p._id && p._id.toString() === pageId);
  if (rootPage) {
    return {
      parent: rootPages,
      page: rootPage,
      index: rootPages.indexOf(rootPage),
      location: 'root',
      container: pedagogyElement
    };
  }

  // Search in folders recursively
  const searchInFolders = (folders, path = []) => {
    if (!Array.isArray(folders)) return null;

    for (let folder of folders) {
      const folderPages = Array.isArray(folder.pages) ? folder.pages : [];
      const pageInFolder = folderPages.find(p => p._id && p._id.toString() === pageId);

      if (pageInFolder) {
        return {
          parent: folderPages,
          page: pageInFolder,
          index: folderPages.indexOf(pageInFolder),
          location: 'folder',
          container: folder,
          folderPath: [...path, folder.name]
        };
      }

      // Search in subfolders recursively
      if (Array.isArray(folder.subfolders) && folder.subfolders.length > 0) {
        const result = searchInFolders(folder.subfolders, [...path, folder.name]);
        if (result) return result;
      }
    }
    return null;
  };

  const folders = Array.isArray(pedagogyElement.folders) ? pedagogyElement.folders : [];
  return searchInFolders(folders);
};

// Find pages in a specific folder
const findPagesInFolder = (pedagogyElement, folderPathArray) => {
  if (!folderPathArray || folderPathArray.length === 0) {
    // Return root pages
    return Array.isArray(pedagogyElement.pages) ? pedagogyElement.pages : [];
  }

  // Navigate to the folder
  let currentFolder = null;
  let currentFolders = Array.isArray(pedagogyElement.folders) ? pedagogyElement.folders : [];

  for (let i = 0; i < folderPathArray.length; i++) {
    const folderName = folderPathArray[i];
    currentFolder = currentFolders.find(f => f.name === folderName);

    if (!currentFolder) {
      return []; // Folder not found
    }

    if (i < folderPathArray.length - 1) {
      currentFolders = Array.isArray(currentFolder.subfolders) ? currentFolder.subfolders : [];
    }
  }

  // Return pages from the target folder
  return currentFolder && Array.isArray(currentFolder.pages) ? currentFolder.pages : [];
};

// Get page by ID with full context
const getPageWithContext = async (entityType, entityId, pageId, tabType, subcategory) => {
  const Model = mongoose.model(getModelName(entityType));
  const entity = await Model.findById(entityId);

  if (!entity || !entity.pedagogy?.[tabType]?.get(subcategory)) {
    return null;
  }

  const pedagogyElement = entity.pedagogy[tabType].get(subcategory);
  const pageContext = findPageById(pedagogyElement, pageId);

  if (!pageContext) {
    return null;
  }

  return {
    ...pageContext.page.toObject(),
    location: pageContext.location,
    folderPath: pageContext.folderPath || [],
    containerId: pageContext.container._id,
    containerName: pageContext.container.name || 'root'
  };
};



/**
 * Update a page
 */
// exports.updatePage = async (req, res) => {
//   try {
//     const { type, id, pageId } = req.params;
//     const { title, blocks, combinedCode, tabType, subcategory } = req.body;

//     const modelMap = {
//       module: mongoose.model("Module1"),
//       submodule: mongoose.model("SubModule1"),
//       topic: mongoose.model("Topic1"),
//       subtopic: mongoose.model("SubTopic1")
//     };

//     const Model = modelMap[type];
//     const entity = await Model.findById(id);

//     if (!entity) {
//       return res.status(404).json({ message: [{ key: "error", value: `${type} not found` }] });
//     }

//     const pedagogyElement = entity.pedagogy?.[tabType]?.get(subcategory);

//     if (!pedagogyElement) {
//       return res.status(404).json({
//         message: [{ key: "error", value: "Pedagogy element not found" }]
//       });
//     }

//     // Find the page
//     const pageResult = findPageById(pedagogyElement, pageId);

//     if (!pageResult) {
//       return res.status(404).json({
//         message: [{ key: "error", value: "Page not found" }]
//       });
//     }

//     // Update page
//     const page = pageResult.page;
//     if (title) page.title = title;
//     if (blocks) page.blocks = typeof blocks === 'string' ? JSON.parse(blocks) : blocks;
//     if (combinedCode) page.combinedCode = combinedCode;
//     page.updatedAt = new Date();
//     page.updatedBy = req.user?.email || "system";

//     // Mark as modified
//     if (pageResult.location === 'root') {
//       entity.markModified(`pedagogy.${tabType}.${subcategory}.pages`);
//     } else {
//       entity.markModified(`pedagogy.${tabType}.${subcategory}.folders`);
//     }

//     entity.updatedBy = req.user?.email || "system";
//     entity.updatedAt = new Date();

//     await entity.save();

//     return res.status(200).json({
//       success: true,
//       message: [{ key: "success", value: "Page updated successfully" }],
//       page: page,
//       location: pageResult.location,
//       folderPath: pageResult.folderPath
//     });

//   } catch (err) {
//     console.error("Update page error:", err);
//     res.status(500).json({
//       success: false,
//       message: [{ key: "error", value: "Internal server error" }]
//     });
//   }
// };

/**
 * Delete a page
 */
// ─── deletePage ───────────────────────────────────────────────────────────────
exports.deletePage = async (req, res) => {
  try {
    const { type, id, pageId } = req.params;
    const { tabType, subcategory, folderPath } = req.body;

    if (!tabType || !subcategory) {
      return res.status(400).json({
        message: [{ key: "error", value: "tabType and subcategory are required" }],
      });
    }

    if (!mongoose.Types.ObjectId.isValid(pageId)) {
      return res.status(400).json({
        message: [{ key: "error", value: "Invalid pageId format" }],
      });
    }

    const modelMap = {
      module: mongoose.model("Module1"),
      submodule: mongoose.model("SubModule1"),
      topic: mongoose.model("Topic1"),
      subtopic: mongoose.model("SubTopic1"),
    };

    const Model = modelMap[type];
    if (!Model) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}` }],
      });
    }

    const entity = await Model.findById(id);
    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} not found` }],
      });
    }

    if (!entity.pedagogy?.[tabType]) {
      return res.status(404).json({
        message: [{ key: "error", value: "Pedagogy section not found" }],
      });
    }

    // Support both Map and plain Object
    const pedagogyElement = entity.pedagogy[tabType].get
      ? entity.pedagogy[tabType].get(subcategory)
      : entity.pedagogy[tabType][subcategory];

    if (!pedagogyElement) {
      return res.status(404).json({
        message: [{ key: "error", value: `Subcategory "${subcategory}" not found` }],
      });
    }

    // Resolve folder path
    let folderPathArray = [];
    if (Array.isArray(folderPath)) {
      folderPathArray = folderPath;
    } else if (typeof folderPath === "string" && folderPath.trim()) {
      folderPathArray = folderPath.includes(",")
        ? folderPath.split(",").filter(Boolean)
        : folderPath.split("/").filter(Boolean);
    }

    // Navigate into folder if path given
    let targetContainer = pedagogyElement;
    let deletedFromFolder = false;

    if (folderPathArray.length > 0) {
      // Walk folder tree by name
      let current = pedagogyElement.folders || [];
      let found = null;
      for (const name of folderPathArray) {
        found = current.find(f => f.name === name);
        if (!found) {
          return res.status(404).json({
            message: [{ key: "error", value: `Folder "${name}" not found in path` }],
          });
        }
        current = found.subfolders || [];
      }
      if (!Array.isArray(found.pages)) found.pages = [];
      targetContainer = found;
      deletedFromFolder = true;
    }

    if (!Array.isArray(targetContainer.pages)) {
      return res.status(404).json({
        message: [{ key: "error", value: "No pages found in target location" }],
      });
    }

    // Find the page
    const pageIndex = targetContainer.pages.findIndex(
      p => p._id && p._id.toString() === pageId
    );

    if (pageIndex === -1) {
      return res.status(404).json({
        message: [{ key: "error", value: `Page "${pageId}" not found` }],
      });
    }

    const deletedPage = targetContainer.pages[pageIndex];

    // Remove it
    targetContainer.pages.splice(pageIndex, 1);

    // Mark modified so Mongoose persists the nested array change
    if (deletedFromFolder) {
      entity.markModified(`pedagogy.${tabType}.${subcategory}.folders`);
    } else {
      entity.markModified(`pedagogy.${tabType}.${subcategory}.pages`);
    }

    entity.updatedBy = req.user?.email || "system";
    entity.updatedAt = new Date();

    await entity.save({ validateModifiedOnly: true });

    return res.status(200).json({
      success: true,
      message: [{ key: "success", value: "Page deleted successfully" }],
      deletedPage: { _id: deletedPage._id, title: deletedPage.title },
      location: deletedFromFolder ? "inside_folder" : "root",
    });

  } catch (err) {
    console.error("Delete page error:", err);

    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: [{ key: "error", value: "Validation error during delete" }],
        errors: err.errors,
      });
    }

    return res.status(500).json({
      success: false,
      message: [{ key: "error", value: "Internal server error" }],
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE PAGE
// PUT /:type/:id/pages/:pageId
// Body: { title?, blocks?, htmlContent?, tabType, subcategory, folderPath? }
// ─────────────────────────────────────────────────────────────────────────────
exports.updatePage = async (req, res) => {
  try {
    const { type, id, pageId } = req.params;
    const {
      title, blocks, htmlContent, combinedCode,
      pages,
      tabType, subcategory, folderPath,
    } = req.body;

    if (!tabType || !subcategory) {
      return res.status(400).json({
        message: [{ key: "error", value: "tabType and subcategory are required" }],
      });
    }

    if (!mongoose.Types.ObjectId.isValid(pageId)) {
      return res.status(400).json({
        message: [{ key: "error", value: "Invalid pageId format" }],
      });
    }

    const Model = getModel(type);
    if (!Model) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}` }],
      });
    }

    const entity = await Model.findById(id);
    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} not found` }],
      });
    }

    if (!entity.pedagogy || !entity.pedagogy[tabType]) {
      return res.status(404).json({
        message: [{ key: "error", value: "Pedagogy section not found" }],
      });
    }

    const pedagogyElement = entity.pedagogy[tabType].get
      ? entity.pedagogy[tabType].get(subcategory)
      : entity.pedagogy[tabType][subcategory];

    if (!pedagogyElement) {
      return res.status(404).json({
        message: [{ key: "error", value: `Subcategory "${subcategory}" not found` }],
      });
    }

    // ── Resolve folder path ───────────────────────────────────────────────────
    const folderPathArray = Array.isArray(folderPath)
      ? folderPath
      : (typeof folderPath === "string" && folderPath.trim()
          ? (folderPath.includes(",") ? folderPath.split(",") : folderPath.split("/")).filter(Boolean)
          : []);

    let targetContainer = pedagogyElement;
    let updatedInFolder = false;

    if (folderPathArray.length > 0) {
      let current = Array.isArray(pedagogyElement.folders) ? pedagogyElement.folders : [];
      let found = null;
      for (const name of folderPathArray) {
        found = current.find(f => f.name === name);
        if (!found) {
          return res.status(404).json({
            message: [{ key: "error", value: `Folder "${name}" not found` }],
          });
        }
        current = Array.isArray(found.subfolders) ? found.subfolders : [];
      }
      if (!Array.isArray(found.pages)) found.pages = [];
      targetContainer = found;
      updatedInFolder = true;
    }

    if (!Array.isArray(targetContainer.pages)) {
      return res.status(404).json({
        message: [{ key: "error", value: "No pages found in target location" }],
      });
    }

    // ── Find page by INDEX (not reference) ───────────────────────────────────
    const pageIndex = targetContainer.pages.findIndex(
      (p) => p._id && p._id.toString() === pageId
    );

    if (pageIndex === -1) {
      return res.status(404).json({
        message: [{ key: "error", value: `Page "${pageId}" not found` }],
      });
    }

    const existingPage = targetContainer.pages[pageIndex];

    // ── Parse incoming data ───────────────────────────────────────────────────
    let parsedPages = [];
    if (pages) {
      parsedPages = typeof pages === "string" ? JSON.parse(pages) : pages;
    }

    let parsedBlocks = existingPage.blocks;
    if (blocks !== undefined) {
      parsedBlocks = typeof blocks === "string" ? JSON.parse(blocks) : blocks;
    } else if (parsedPages.length > 0 && parsedPages[0]?.blocks) {
      parsedBlocks = parsedPages[0].blocks;
    }

    const resolvedCombinedCode = combinedCode || htmlContent || existingPage.combinedCode;

    // ── REPLACE entire page object — reliable Mongoose detection ─────────────
    targetContainer.pages[pageIndex] = {
      _id:          existingPage._id,
      title:        title !== undefined ? title : existingPage.title,
      blocks:       parsedBlocks,
      combinedCode: resolvedCombinedCode,
      pagesData:    parsedPages.length > 0
        ? parsedPages.map(p => ({
            id:     p.id || p._id || String(new mongoose.Types.ObjectId()),
            name:   p.name || p.title || "Untitled",
            html:   p.html || "",
            blocks: p.blocks || [],
          }))
        : existingPage.pagesData,
      isMultiPage:  parsedPages.length > 0 ? parsedPages.length > 1 : existingPage.isMultiPage,
      pageCount:    parsedPages.length > 0 ? parsedPages.length    : existingPage.pageCount,
      version:      existingPage.version   || "1.0.0",
      folderId:     existingPage.folderId,
      folderPath:   existingPage.folderPath,
      createdAt:    existingPage.createdAt,
      createdBy:    existingPage.createdBy,
      updatedAt:    new Date(),
      updatedBy:    req.user?.email || "system",
    };

    if (updatedInFolder) {
      entity.markModified(`pedagogy.${tabType}.${subcategory}.folders`);
    } else {
      entity.markModified(`pedagogy.${tabType}.${subcategory}.pages`);
    }

    entity.updatedBy = req.user?.email || "system";
    entity.updatedAt = new Date();

    await entity.save({ validateModifiedOnly: true });

    return res.status(200).json({
      success: true,
      message: [{ key: "success", value: "Page updated successfully" }],
      page: {
        _id:       targetContainer.pages[pageIndex]._id,
        title:     targetContainer.pages[pageIndex].title,
        updatedAt: targetContainer.pages[pageIndex].updatedAt,
      },
      location: updatedInFolder ? "inside_folder" : "root",
    });

  } catch (err) {
    console.error("Update page error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: [{ key: "error", value: "Validation error during update" }],
        errors: err.errors,
      });
    }
    return res.status(500).json({
      success: false,
      message: [{ key: "error", value: "Internal server error" }],
    });
  }
};



const findEntityByTypeAndId = async (type, id) => {
  const modelMap = {
    module: mongoose.model("Module1"),
    submodule: mongoose.model("SubModule1"),
    topic: mongoose.model("Topic1"),
    subtopic: mongoose.model("SubTopic1")
  };

  if (!modelMap[type]) {
    throw new Error(`Invalid entity type: ${type}`);
  }

  const Model = modelMap[type];
  const entity = await Model.findById(id);

  if (!entity) {
    throw new Error(`${type} not found with id: ${id}`);
  }

  return entity;
};

// Helper function to find file in pedagogy structure
const findFileInPedagogy = (entity, tabType, subcategory, folderPath, fileId) => {
  if (!entity.pedagogy || !entity.pedagogy[tabType]) {
    return { error: "Pedagogy section not found" };
  }

  const pedagogyElement = entity.pedagogy[tabType].get(subcategory);
  if (!pedagogyElement) {
    return { error: "Subcategory not found" };
  }

  let targetFiles = [];
  let targetContainer = pedagogyElement;

  // Parse folderPath if it's a string
  let parsedFolderPath = folderPath;
  if (typeof folderPath === 'string') {
    try {
      parsedFolderPath = JSON.parse(folderPath);
    } catch (e) {
      // If it's not valid JSON, treat as empty array
      parsedFolderPath = [];
    }
  }

  // Ensure parsedFolderPath is an array
  if (!Array.isArray(parsedFolderPath)) {
    parsedFolderPath = [];
  }

  // If folder path exists, navigate through folders
  if (parsedFolderPath && parsedFolderPath.length > 0) {
    let currentFolders = pedagogyElement.folders || [];
    let currentFolder = null;

    for (const folderName of parsedFolderPath) {
      currentFolder = currentFolders.find(f => f.name === folderName);
      if (!currentFolder) {
        return { error: `Folder not found: ${folderName}` };
      }
      currentFolders = currentFolder.folders || [];
    }

    if (currentFolder) {
      targetContainer = currentFolder;
      targetFiles = currentFolder.files || [];
    }
  } else {
    targetFiles = pedagogyElement.files || [];
  }

  // Find the specific file
  const fileIndex = targetFiles.findIndex(f => f._id.toString() === fileId);
  if (fileIndex === -1) {
    return { error: "File not found" };
  }

  return {
    container: targetContainer,
    files: targetFiles,
    fileIndex,
    file: targetFiles[fileIndex]
  };
};

// Helper function to update lastModified in fileSettings
const updateFileLastModified = (file) => {
  if (file.fileSettings) {
    file.fileSettings.lastModified = new Date();
  }
};



// Add MCQ question to a file
async function uploadImageToSupabase(file, folderPath) {
  try {
    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
    const fileName = `${timestamp}_${sanitizedName}`;
    const filePath = `question/${folderPath}/${fileName}`;

    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from("smartlms")
      .upload(filePath, file.data, {
        contentType: file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    // Generate public URL
    const imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/${filePath}`;

    return imageUrl;

  } catch (error) {
    console.error("❌ Image upload failed:", error);
    throw error;
  }
}

// Add MCQ question to a file
exports.addMCQQuestionToFile = async (req, res) => {
  try {
    const { type, id } = req.params; // type: module/submodule/topic/subtopic

    // Parse body fields
    let {
      tabType, // I_Do, We_Do, You_Do
      subcategory, // lecture, assignments, etc.
      folderPath, // array of folder names (might be string or array)
      fileId,
      questionsData  // Accept array or single object
    } = req.body;

    // ✅ Parse folderPath if it's a string
    if (typeof folderPath === 'string') {
      try {
        folderPath = JSON.parse(folderPath);
      } catch (e) {
        // If parsing fails, treat as empty array
        folderPath = [];
      }
    }

    // Ensure folderPath is an array
    if (!Array.isArray(folderPath)) {
      folderPath = [];
    }

    // ✅ Parse questionsData if it's a string (from FormData)
    if (typeof questionsData === 'string') {
      try {
        questionsData = JSON.parse(questionsData);
      } catch (parseError) {
        console.error('❌ Failed to parse questionsData JSON:', parseError);
        return res.status(400).json({
          success: false,
          message: [{ key: "error", value: "Invalid questionsData format. Must be valid JSON." }]
        });
      }
    }

    // Validate required fields
    if (!tabType || !subcategory || !fileId || !questionsData) {
      return res.status(400).json({
        success: false,
        message: [{ key: "error", value: "Missing required fields: tabType, subcategory, fileId, questionsData" }]
      });
    }

    // Convert to array if single object is sent
    const questionsArray = Array.isArray(questionsData) ? questionsData : [questionsData];

    if (questionsArray.length === 0) {
      return res.status(400).json({
        success: false,
        message: [{ key: "error", value: "questionsData cannot be empty" }]
      });
    }

    // Find the entity (module/submodule/topic/subtopic)
    const entity = await findEntityByTypeAndId(type, id);

    // Initialize pedagogy if not exists
    if (!entity.pedagogy) {
      entity.pedagogy = { I_Do: new Map(), We_Do: new Map(), You_Do: new Map() };
    }

    // Ensure pedagogy section exists
    if (!entity.pedagogy[tabType]) {
      entity.pedagogy[tabType] = new Map();
    }

    // Ensure subcategory exists
    if (!entity.pedagogy[tabType].get(subcategory)) {
      entity.pedagogy[tabType].set(subcategory, {
        description: "",
        files: [],
        folders: [],
        pages: []
      });
    }

    // Find the file
    const result = findFileInPedagogy(entity, tabType, subcategory, folderPath, fileId);

    if (result.error) {
      return res.status(404).json({
        success: false,
        message: [{ key: "error", value: result.error }]
      });
    }

    const { file } = result;

    // Initialize mcqQuestions array if not exists
    if (!file.mcqQuestions) {
      file.mcqQuestions = [];
    }

    // Parse folderPath for storage
    const parsedFolderPath = folderPath || [];
    const savedQuestions = [];

    // Process each question in the array
    for (let i = 0; i < questionsArray.length; i++) {
      const questionData = questionsArray[i];

      // Validate each question
      if (!questionData.mcqQuestionTitle || !questionData.mcqQuestionTitle.trim()) {
        return res.status(400).json({
          success: false,
          message: [{ key: "error", value: `Question ${i + 1}: title is required` }]
        });
      }

      if (!questionData.mcqQuestionOptions || !Array.isArray(questionData.mcqQuestionOptions) || questionData.mcqQuestionOptions.length < 2) {
        return res.status(400).json({
          success: false,
          message: [{ key: "error", value: `Question ${i + 1}: At least 2 options are required` }]
        });
      }

      if (!questionData.mcqQuestionCorrectAnswers || !Array.isArray(questionData.mcqQuestionCorrectAnswers) || questionData.mcqQuestionCorrectAnswers.length === 0) {
        return res.status(400).json({
          success: false,
          message: [{ key: "error", value: `Question ${i + 1}: At least one correct answer is required` }]
        });
      }

      // Process options and upload images
      const formattedOptions = await Promise.all(
        questionData.mcqQuestionOptions.map(async (opt, optIndex) => {
          let imageUrl = opt.imageUrl || null;

          // Check if there's an image file uploaded for this option
          const imageField = `question_${i}_option_${optIndex}_image`;
          const imageFile = req.files?.[imageField];

          if (imageFile) {
            try {
              const uploadedImageUrl = await uploadImageToSupabase(
                imageFile,
                `mcq/files/${fileId}/question_${Date.now()}_option_${optIndex}`
              );
              imageUrl = uploadedImageUrl;
            } catch (uploadError) {
              console.error(`Error uploading image for option ${optIndex}:`, uploadError);
              return res.status(500).json({
                success: false,
                message: [{ key: "error", value: `Failed to upload image for option ${optIndex + 1}` }]
              });
            }
          }

          return {
            text: opt.text || '',
            isCorrect: opt.isCorrect || questionData.mcqQuestionCorrectAnswers.includes(opt.text) || false,
            imageUrl: imageUrl,
            imageAlignment: opt.imageAlignment || 'left',
            imageSizePercent: opt.imageSizePercent || 100
          };
        })
      );

      // Process question image if any
      let questionImageUrl = null;
      const questionImageField = `question_${i}_image`;
      const questionImageFile = req.files?.[questionImageField];

      if (questionImageFile) {
        try {
          questionImageUrl = await uploadImageToSupabase(
            questionImageFile,
            `mcq/files/${fileId}/question_${Date.now()}_main`
          );
        } catch (uploadError) {
          console.error('Error uploading question image:', uploadError);
          return res.status(500).json({
            success: false,
            message: [{ key: "error", value: `Failed to upload image for question ${i + 1}` }]
          });
        }
      }


      // Create new MCQ question with updated schema
      const newMCQQuestion = {
        _id: new mongoose.Types.ObjectId(),
        isActive: questionData.isActive !== undefined ? questionData.isActive : true,
        sequence: questionData.sequence || file.mcqQuestions.length + 1,
        timestamp: questionData.videoTimestamp || questionData.timestamp || 0,
        videoTimestamp: questionData.videoTimestamp || questionData.timestamp || 0,
        mcqQuestion: {
          questionTitle: questionData.mcqQuestionTitle,
          explanation: questionData.mcqQuestionDescription || '',
          options: formattedOptions,
          correctAnswers: questionData.mcqQuestionCorrectAnswers,
          mcqQuestionType: questionData.mcqQuestionType,
          mcqQuestionOptionsPerRow: questionData.mcqQuestionOptionsPerRow || 2,
          mcqQuestionRequired: questionData.mcqQuestionRequired !== undefined ? questionData.mcqQuestionRequired : true
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: req.user?.email || 'system',
        updatedBy: req.user?.email || 'system'
      };

      // Add question image if exists
      if (questionImageUrl) {
        newMCQQuestion.mcqQuestion.questionImage = {
          imageUrl: questionImageUrl,
          alignment: questionData.mcqQuestionImageAlignment || 'center',
          sizePercent: questionData.mcqQuestionImageSizePercent || 60
        };
      }


      // Add the question
      file.mcqQuestions.push(newMCQQuestion);
      savedQuestions.push(newMCQQuestion);
    }

    // Update lastModified in fileSettings
    updateFileLastModified(file);

    // Mark the path as modified for Mongoose
    if (parsedFolderPath.length > 0) {
      entity.markModified(`pedagogy.${tabType}.${subcategory}.folders`);
    } else {
      entity.markModified(`pedagogy.${tabType}.${subcategory}.files`);
    }

    entity.updatedBy = req.user?.email || 'system';
    entity.updatedAt = new Date();

    // Save the entity
    await entity.save();

    return res.status(200).json({
      success: true,
      message: [{ key: "success", value: `${savedQuestions.length} MCQ question(s) added successfully` }],
      data: {
        entityType: type,
        entityId: id,
        fileId: fileId,
        folderPath: parsedFolderPath,
        questions: savedQuestions,
        totalQuestions: file.mcqQuestions.length
      }
    });

  } catch (err) {
    console.error("Error adding MCQ question:", err);

    if (err.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: [{ key: "error", value: err.message }]
      });
    }

    return res.status(500).json({
      success: false,
      message: [{ key: "error", value: "Internal server error" }]
    });
  }
};

// ─── getExerciseSubmissionStatus ─────────────────────────────────────────────
// GET /analytics/exercise-submission-status
// Query params: courseId, tabType, subcategory, exerciseIds (comma-separated)
// Returns { [exerciseId]: boolean } — true when ≥1 enrolled student has
// submitted an answer for that exercise in the given tabType/subcategory.
// Fully dynamic: works for ANY tabType and ANY subcategory key.
exports.getExerciseSubmissionStatus = async (req, res) => {
  try {
    const { courseId, tabType, subcategory, exerciseIds } = req.query;

    if (!courseId || !tabType || !subcategory || !exerciseIds) {
      return res.status(400).json({
        success: false,
        message: 'courseId, tabType, subcategory, and exerciseIds are required',
      });
    }

    const validTabs = ['I_Do', 'We_Do', 'You_Do'];
    if (!validTabs.includes(tabType)) {
      return res.status(400).json({
        success: false,
        message: `tabType must be one of: ${validTabs.join(', ')}`,
      });
    }

    let courseObjectId;
    try {
      courseObjectId = new mongoose.Types.ObjectId(courseId);
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid courseId' });
    }

    // Parse the exercise IDs list
    const idList = exerciseIds.split(',').map(id => id.trim()).filter(Boolean);
    if (!idList.length) {
      return res.status(200).json({ success: true, data: {} });
    }

    // Build the result map — default false for every requested ID
    const statusMap = {};
    const idStringSet = new Set();
    idList.forEach(id => {
      // Validate each ID is a valid ObjectId before adding
      try {
        new mongoose.Types.ObjectId(id);
        statusMap[id] = false;
        idStringSet.add(id);
      } catch { /* skip invalid IDs */ }
    });

    if (!idStringSet.size) {
      return res.status(200).json({ success: true, data: statusMap });
    }

    // Find all users enrolled in this course.
    // We use .lean() so answers Map becomes a plain JS object with subcategory keys.
    const users = await User.find(
      { 'courses.courseId': courseObjectId },
      { courses: 1 }
    ).lean();

    for (const user of users) {
      const courseEntry = (user.courses || []).find(
        c => c.courseId && c.courseId.toString() === courseId
      );
      if (!courseEntry || !courseEntry.answers) continue;

      // tabType is dynamic: 'I_Do' | 'We_Do' | 'You_Do'
      const tabAnswers = courseEntry.answers[tabType];
      if (!tabAnswers) continue;

      // subcategory is dynamic: 'assignments' | 'quizzes' | 'practice' | any key
      // After .lean(), a Mongoose Map becomes a plain object
      const subcategoryEntries = tabAnswers[subcategory];
      if (!Array.isArray(subcategoryEntries)) continue;

      for (const entry of subcategoryEntries) {
        if (!entry.exerciseId) continue;
        const entryIdStr = entry.exerciseId.toString();
        if (idStringSet.has(entryIdStr)) {
          statusMap[entryIdStr] = true;
        }
      }

      // Early exit once every exercise has at least one submission
      if (Object.values(statusMap).every(Boolean)) break;
    }

    return res.status(200).json({ success: true, data: statusMap });
  } catch (error) {
    console.error('Error fetching exercise submission status:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};