import BaseAppLayout from "../../../components/base-app-layout";
import Chat from "../../../components/chatbot/chat";

import { Link, useParams } from "react-router-dom";
import { Header, HelpPanel } from "@cloudscape-design/components";

export default function Playground() {
  const { sessionId } = useParams();

  return (    
    <BaseAppLayout
      info={
        <HelpPanel header={<Header variant="h3">About this chatbot</Header>}>
          <p>
            ABE is OSD's chatbot for answering questions about procurement in Massachusetts.
            It provides tailored information by referencing specific documents.
          </p>

          <h3>How to Use</h3>
          <p>
            ABE is very simple to use! Type your question or request into the input box, and ABE will respond with relevant information. 
            <br />
            <span style={{ marginTop: "10px", display: "block" }}>
              Need a little guidance? <Link to="/chatbot/tips">Click here for prompting tips and sample questions to help you get started!</Link>
            </span>
          </p>

          <h3>Feedback</h3>
          <p>
            You can submit feedback on any response by selecting a category, describing the issue, and adding comments (for negative feedback).
            Your input is essential for improving ABE's accuracy and performance!
          </p>

          <h3>Data Sources</h3>
          <p>
            ABE references official sources like
            <a style={{padding: "0px 4px"}} href="https://www.mass.gov/doc/conducting-best-value-procurements-handbook/download" target="_blank" rel="noopener noreferrer">
            OSD's Best Value Procurement Handbook
            </a>
            to provide accurate, up-to-date guidance for navigating procurement processes.
          </p>

          <h3>Support</h3>
          <p>
            For additional assistance, reach OSD through one of the methods listed on 
            <a style={{paddingLeft: "4px"}} href="https://www.mass.gov/orgs/operational-services-division" target="_blank" rel="noopener noreferrer">
              their website.
            </a>
          </p>
        </HelpPanel>
      }
      toolsWidth={300}       
      content={
       <div>
      {/* <Chat sessionId={sessionId} /> */}
      
      <Chat sessionId={sessionId} />
      </div>
     }
    />    
  );
}
