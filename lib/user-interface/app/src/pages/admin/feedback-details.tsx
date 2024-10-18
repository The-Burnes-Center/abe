import React from 'react'
import { useLocation } from 'react-router-dom';
// ChatbotMessage, CreatedAt, FeedbackComments, FeedbackID, Problem, Sources, UserPrompt

const UserFeedbackDetailPage = () => {

  const location = useLocation();
  const feedbackItem = location.state?.feedback;

  return (
    <div>
      <h1>Feedback Details</h1>
      {feedbackItem ? (
        <div>
          <p><strong>Problem:</strong> {feedbackItem.Problem}</p>
          <p><strong>User Prompt:</strong> {feedbackItem.UserPrompt}</p>
          <p><strong>Created At:</strong> {feedbackItem.CreatedAt}</p>
          {/* Render more feedback details here */}
        </div>
      ) : (
        <p>No feedback data available.</p>
      )}
    </div>
  )
}

export default UserFeedbackDetailPage