import {
    BreadcrumbGroup,
    ContentLayout,
    Header,
    SpaceBetween,
    Alert,
    Tabs,
    Container
  } from "@cloudscape-design/components";
  import useOnFollow from "../../common/hooks/use-on-follow";
  import BaseAppLayout from "../../components/base-app-layout";
  import { CHATBOT_NAME } from "../../common/constants";
  import { useState, useEffect, useContext } from "react";
  import { Auth } from "aws-amplify";
  import { ApiClient } from "../../common/api-client/api-client";
  import { AppContext } from "../../common/app-context";
  import styled from "styled-components";

  const PageContainer = styled.div`
    box-sizing: border-box;
    padding: 20px 0;
  `;
  
  export default function AboutChatbot() {
    const onFollow = useOnFollow();
    const [activeTab, setActiveTab] = useState("file");
    const appContext = useContext(AppContext);

  
 
  
    return (
        <BaseAppLayout
          contentType="cards"
          content={
            <PageContainer>
                Hello
            </PageContainer>
          }
        />
      );
    }