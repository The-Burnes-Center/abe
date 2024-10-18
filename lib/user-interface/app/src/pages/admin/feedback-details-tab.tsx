import React from 'react';
import Container from '@cloudscape-design/components';
// ChatbotMessage, CreatedAt, FeedbackComments, FeedbackID, Problem, Sources, UserPrompt

const FeedbackDetailsTab = ({selectedFeedback}) => {

  const containerStyle = {
    backgroundColor: 'white',
    padding: '16px 20px 20px 20px',
    borderRadius: '16px',
    boxShadow: 'var(--shadow-container-mwue46, 0px 1px 1px 1px #e9ebed, 0px 2px 8px 2px rgba(0, 7, 22, 0.12))',
  };

  const headerStyle = {
    fontSize: '20px',
    lineHeight: '24px',
    letterSpacing: '-0.015em',
    fontWeight: 700,
    WebkitFontSmoothing: 'antialiased',
  };

  return (
    <div style={containerStyle}>
        <div style={headerStyle}>
            {`Feedback ID: ${selectedFeedback.FeedbackID}`}
        </div>
        <div style={{paddingTop: '10px'}}>
            <h4>Submission Time:</h4>
            <p>{selectedFeedback.CreatedAt}</p>

            <h4>Problem:</h4>
            <p>{selectedFeedback.Problem}</p>

            <h4>User Prompt:</h4>
            <p>{selectedFeedback.UserPrompt}</p>

            <h4>Chatbot Response:</h4>
            <p>{selectedFeedback.ChatbotMessage}</p>

            <h4>User Feedback Comments:</h4>
            <p>{selectedFeedback.FeedbackComments}</p>

            <h4>Response Sources:</h4>
            <p>{selectedFeedback.Sources}</p>
        </div>
    </div>
  )
}

export default FeedbackDetailsTab