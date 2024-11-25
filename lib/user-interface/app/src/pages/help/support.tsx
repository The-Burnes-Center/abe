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
  
  export default function Support() {
    const onFollow = useOnFollow();
    const [activeTab, setActiveTab] = useState("file");
    const appContext = useContext(AppContext);

  
 
  
    return (
        <BaseAppLayout
          contentType="cards"
          content={
            <ContentLayout
              header={
                <Header
                  variant="h1"
                >
                  Support
                </Header>
              }
            >
              <SpaceBetween size="l">
                <Container
                  header={
                    <Header
                      variant="h3"
                      // description="Container description"
                    >
                      An AI-powered chatbot that helps students explore academic and career paths.
                    </Header>                
                  }
                >
                  <SpaceBetween size="xxs">
                  The MATCH Chatbot is designed to help you research how specific courses and programs at public higher education institutions within MA can set you up for a fullfilling career.
    
                  <br></br>
          
                  </SpaceBetween>
                </Container>
                <Tabs
                  tabs={[
                      {
                      label: "About the MATCH Chatbot",
                      id: "about-the-tool",
                    //   content: (
                    //       <AboutTheToolTab
                    //       tabChangeFunction={() => setActiveTab("about-the-tool")}
                    //       />
                    //   ),
                      },
                      {
                      label: "How To Use MATCH",
                      id: "how-to-use",
                    //   content: (
                    //     <HowToUseTab 
                    //       tabChangeFunction={() => setActiveTab("how-to-use")}
                    //     />
                    //   ),
                      },
                      {
                      label: "FAQs and Support",
                      id: "support",
                    //   content: (
                    //       <SupportTab 
                    //       tabChangeFunction={() => setActiveTab("support")}
                    //       />
                    //   ),
                      },
                  ]}
                  activeTabId={activeTab}
                  onChange={({ detail: { activeTabId } }) => {
                      setActiveTab(activeTabId);
                  }}
                  />
    
              </SpaceBetween>
            </ContentLayout>
          }
        />
      );
    }