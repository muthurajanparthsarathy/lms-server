const User = require("../models/UserModel");



exports.getUserNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Populate enrolledBy field with user details
    const user = await User.findById(userId)
      .populate({
        path: 'notifications.enrolledBy',
        select: 'firstName lastName email',
        model: 'LMS-User'
      })
      .select('notifications');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Sort notifications by date (newest first)
    const sortedNotifications = user.notifications.sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    
    // Convert notifications to plain objects and handle Map
    const processedNotifications = sortedNotifications.map(notification => {
      const notificationObj = notification.toObject();
      
      // Convert metadata Map to object
      const metadataObj = {};
      if (notificationObj.metadata && notificationObj.metadata.forEach) {
        notificationObj.metadata.forEach((value, key) => {
          metadataObj[key] = value;
        });
      }
      
      // Check if enrolledBy is populated
      let enrolledByInfo = null;
      if (notificationObj.enrolledBy) {
        const enrolledByUser = notificationObj.enrolledBy;
        enrolledByInfo = {
          id: enrolledByUser._id,
          name: `${enrolledByUser.firstName || ''} ${enrolledByUser.lastName || ''}`.trim(),
          email: enrolledByUser.email,
          isPopulated: true
        };
      }
      
      return {
        ...notificationObj,
        metadata: metadataObj,
        enrolledByInfo: enrolledByInfo
      };
    });
    
    // Count unread notifications
    const unreadCount = processedNotifications.filter(notif => !notif.isRead).length;
    
    res.status(200).json({
      success: true,
      data: {
        notifications: processedNotifications,
        unreadCount,
        totalCount: processedNotifications.length
      }
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
};

// Mark notification as read
exports.markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const notification = await user.markNotificationAsRead(notificationId);
    
    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: notification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error.message
    });
  }
};

// Mark all notifications as read
// In your notifications.js controller
exports.markAllNotificationsAsRead = async (req, res) => {
  try {
    
    // Try different possible user ID properties
    const userId = req.user.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    await user.markAllNotificationsAsRead();
    
    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notifications as read',
      error: error.message
    });
  }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Find the notification
    const notification = user.notifications.id(notificationId);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }
    
    // Check if notification was unread to update count
    const wasUnread = !notification.isRead;
    
    // Remove the notification using pull method
    user.notifications.pull({ _id: notificationId });
    
    // Update unread count if needed
    if (wasUnread) {
      user.unreadNotificationCount = Math.max(0, user.unreadNotificationCount - 1);
    }
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
      error: error.message
    });
  }
};


// Get notification count
exports.getNotificationCount = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findById(userId)
      .select('unreadNotificationCount');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        unreadCount: user.unreadNotificationCount
      }
    });
  } catch (error) {
    console.error('Error fetching notification count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification count',
      error: error.message
    });
  }
};

// Delete all notifications
exports.deleteAllNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Clear all notifications
    user.notifications = [];
    user.unreadNotificationCount = 0;
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'All notifications deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting all notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notifications',
      error: error.message
    });
  }
};


exports.toggleFavoriteNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Find the notification
    const notification = user.notifications.id(notificationId);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }
    
    // Toggle favorite status
    notification.isFavorite = !notification.isFavorite;
    await user.save();
    
    res.status(200).json({
      success: true,
      message: `Notification ${notification.isFavorite ? 'added to' : 'removed from'} favorites`,
      data: {
        isFavorite: notification.isFavorite,
        notification: {
          _id: notification._id,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          relatedEntity: notification.relatedEntity,
          isRead: notification.isRead,
          isFavorite: notification.isFavorite,
          createdAt: notification.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Error toggling favorite notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle favorite status',
      error: error.message
    });
  }
};