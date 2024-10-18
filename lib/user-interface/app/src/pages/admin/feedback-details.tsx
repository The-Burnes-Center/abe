import React from 'react'
import { useLocation } from 'react-router-dom';
import {
  BreadcrumbGroup,
  ContentLayout,
  Header,
  SpaceBetween,
  Alert
} from "@cloudscape-design/components";
import {
  Authenticator,
  Heading,
  useTheme,
} from "@aws-amplify/ui-react";
import BaseAppLayout from "../../components/base-app-layout";
import useOnFollow from "../../common/hooks/use-on-follow";
import FeedbackTab from "./feedback-tab";
import FeedbackPanel from "../../components/feedback-panel";
import { CHATBOT_NAME } from "../../common/constants";
import { useState, useEffect } from "react";
import { Auth } from "aws-amplify";
import FeedbackDetailsTab from './feedback-details-tab';
// ChatbotMessage, CreatedAt, FeedbackComments, FeedbackID, Problem, Sources, UserPrompt

const UserFeedbackDetailPage = () => {

  const location = useLocation();
  const feedbackItem = location.state?.feedback;
  const onFollow = useOnFollow();  

  return (    
    <BaseAppLayout
      contentType="cards"
      breadcrumbs={
        <BreadcrumbGroup
          onFollow={onFollow}
          items={[
            {
              text: CHATBOT_NAME,
              href: "/",
            },

            {
              text: "View Feedback",
              href: "/admin/user-feedback",
            },

            {
              text: "Feedback Details",
              href: `/admin/user-feedback/${feedbackItem.FeedbackID}`,
            },
          ]}
        />
      }

      content={
        <ContentLayout header={<Header variant="h1">Feedback Details</Header>}>
          <SpaceBetween size="l">
                {/* <FeedbackTab updateSelectedFeedback={setFeedback} selectedFeedback={feedback}/> */}
                <FeedbackDetailsTab />
          </SpaceBetween>
        </ContentLayout>
      }
    />
  );
}

export default UserFeedbackDetailPage