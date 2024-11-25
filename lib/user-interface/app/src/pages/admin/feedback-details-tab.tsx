import React from 'react';
import Container from '@cloudscape-design/components';
// ChatbotMessage, CreatedAt, FeedbackComments, FeedbackID, Problem, Sources, UserPrompt

const FeedbackDetailsTab = ({selectedFeedback}) => {

  const containerStyle = {
    backgroundColor: 'white',
    padding: '13px 20px 20px 20px',
    borderRadius: '16px',
    boxShadow: 'var(--shadow-container-mwue46, 0px 1px 1px 1px #e9ebed, 0px 2px 8px 2px rgba(0, 7, 22, 0.12))',
  };

  const headerStyle = {
    fontSize: '20px',
    lineHeight: '30px',
    letterSpacing: '0.005em',
    fontWeight: 700,
    WebkitFontSmoothing: 'antialiased',
  };

  const separatorStyle = {
    margin: '13px 0px 25px 0',
    height: '1.5px',     
    backgroundColor: 'lightgray', 
    border: 'none',
  };  

  const topicStyle = {
    fontSize: '16px',
    fontWeight: 600,
    marginRight: '7px',
  };

  const subSeparatorStyle = {
    margin: '15px 0px',
    height: '1.25px',     
    backgroundColor: '#eeeeee', 
    border: 'none',
  };  

  return (
    <div style={containerStyle}>
        <div style={headerStyle}>
            {`Feedback ID: ${selectedFeedback.FeedbackID}`}
        </div>
        <hr style={separatorStyle} />
        <div>
            <span style={topicStyle}>Submission Time:</span>
            <span>
                {new Date(selectedFeedback.CreatedAt).toLocaleString('en-US', {
                    month: 'short',   
                    day: 'numeric',    
                    year: 'numeric',  
                    hour: 'numeric', 
                    minute: 'numeric',  
                    hour12: true     
                })}
            </span> <br/>

            <hr style={subSeparatorStyle} />

            <span style={topicStyle}>Problem:</span>
            <span>
                {selectedFeedback.Problem && selectedFeedback.Problem.trim() !== '' 
                ? selectedFeedback.Problem 
                : 'N/A (Good Response)'}
            </span> <br/>

            <hr style={subSeparatorStyle} />

            <span style={topicStyle}>User Prompt:</span>
            <span>{selectedFeedback.UserPrompt}</span> <br/>

            <hr style={subSeparatorStyle} />

            <span style={topicStyle}>Chatbot Response:</span> 
            <span>{selectedFeedback.ChatbotMessage}</span> <br/>

            <hr style={subSeparatorStyle} />

            <span style={topicStyle}>User Feedback Comments:</span>
            <span>
                {selectedFeedback.FeedbackComments && selectedFeedback.FeedbackComments.trim() !== '' 
                ? selectedFeedback.FeedbackComments 
                : 'N/A'}
            </span> <br/>

            <hr style={subSeparatorStyle} />

            <span style={topicStyle}>Response Sources:</span>
            <span>
            {typeof selectedFeedback.Sources === 'string'
                ? JSON.parse(selectedFeedback.Sources).map(source => source.title).join(', ')
                : Array.isArray(selectedFeedback.Sources) && selectedFeedback.Sources.length > 0
                ? selectedFeedback.Sources.map(source => source.title).join(', ')
                : 'No sources available'}
            </span> 
            <br/><div style={{paddingBottom: "5px"}}></div>
        </div>
    </div>
  )
}

export default FeedbackDetailsTab