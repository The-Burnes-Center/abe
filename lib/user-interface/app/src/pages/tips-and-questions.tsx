import React, { useState } from "react";
import {
    BreadcrumbGroup,
    ContentLayout,
    Header,
    SpaceBetween,
    Alert,
    Tabs,
    Container
  } from "@cloudscape-design/components";
  import BaseAppLayout from "../components/base-app-layout";
  import styled from 'styled-components';
  import useOnFollow from "../common/hooks/use-on-follow";
  import { CHATBOT_NAME } from "../common/constants";
  import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
  import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';

  const OrderedList = styled.div`
    margin: 0;
    padding: 0;
  `;

  const ListItem = styled.div`
    padding: 10px 0;
    display: flex;
    align-items: center;
    justify-content: start;
    font-weight: bold;
  `;

  const Separator = styled.hr`
    background-color: lightgray; 
    height: 1.5px;             
    border: none;            
    margin: 10px 0;
  `;

  const Details = styled.div`
    padding: 5px 29px 13px 29px;
    font-size: 15px;
  `;

  const StyledDownIcon = styled(ArrowDropDownIcon)`
    margin-bottom: -2px;
    margin-right: 5px;
    width: 24px;
    height: 24px;

    &:hover {
        cursor: pointer;
    }
  `;

  const StyledUpIcon = styled(ArrowDropUpIcon)`
    margin-bottom: -2px;
    margin-right: 5px;
    width: 24px;
    height: 24px;

    &:hover {
        cursor: pointer;
    }
  `;

  const ListDetails = styled.li`
  padding: 6px 0px 13px 0px;
  font-size: 15px;
`;
  
  export default function TipsAndQuestions() {
    const onFollow = useOnFollow();
    const [expanded, setExpanded] = useState({});

    const toggleExpand = (index) => {
        setExpanded((prev) => ({ ...prev, [index]: !prev[index] }));
      };
    
    const prompts = [
        { title: "Spell out acronyms", details: "Avoid using abbreviations. For example, instead of 'RFP,' use 'Request for Proposal'." },
        { title: "Be specific and concise", details: "Provide clear and precise questions to help ABE give accurate responses." },
        { title: "Use keywords", details: "Include important terms in your query, such as 'vendor' or 'contract'." },
        { title: "Ask one question at a time", details: "Breaking down complex questions ensures better answers." },
        { title: "Include relevant details", details: "Specify important context, like names, dates, or locations, to guide the chatbot's response." },
        { title: "Ask follow-up questions", details: "Build on previous responses by asking follow-ups to get further clarity or additional details." },
    ];

    const questions = [
        {
          topic: "General Procurement Questions",
          questions: [
            "How can I get started with the procurement process?",
            "What is large procurement?",
            "What is the difference between an RFP and an RFQ?",
            "What are statewide contracts, and how do they work?",
          ],
        },
        {
          topic: "Contracts and Vendors",
          questions: [
            "What contracts are available for \[some product or service\]?",
            "Where can I find a list of all vendors on this contract?",
            "Where is the price list for a certain contract?",
            "Can my agency use this contract?",
            "How can I check if this company is a small business?",
          ],
        },
        {
          topic: "Training and Resources",
          questions: [
            "Where can I download the best value procurement handbook?",
            "Where can I locate job aids for executive agency buyers?",
            "What training or resources are available for new buyers?",
          ],
        },
      ];      
  
    return (
        <BaseAppLayout
          contentType="cards"
          breadcrumbs={
            <BreadcrumbGroup
              onFollow={onFollow}
              items={[
                {
                  text: CHATBOT_NAME,
                  href: "/*",
                },
                {
                  text: "Getting Started",
                  href: "/chatbot/tips",
                },
              ]}
            />
          }
          content={
            <ContentLayout
              header={
                <Header
                  variant="h1"
                >
                  Getting Started
                </Header>
              }
            >
              <SpaceBetween size="l">
                <Container
                  header={
                    <div style={{marginBottom: "-10px"}}>
                        <Header
                        variant="h3"
                        >
                        About this page:
                        </Header> 
                    </div>               
                  }
                >
                  <SpaceBetween size="xxs">
                  <div style={{ lineHeight: "1.6" }}>
                    This page provides tips and sample questions to help you get the most out of ABE. 
                    Here, you can learn how to phrase your questions effectively and explore examples to guide your interactions for quick and accurate procurement assistance.
                  </div>
                  </SpaceBetween>
                </Container>

                <Container
                    header={
                    <div style={{marginBottom: "-2px", marginTop: "2px"}}>
                        <Header
                        variant="h3"
                        >
                        Prompting Tips:
                        </Header> 
                    </div>               
                  }
                >
                    <hr style={{
                        backgroundColor: "lightgray", 
                        height: "1.5px",              
                        border: "none",             
                        margin: "0 0 10px 0", 
                    }} />
                    <OrderedList>
                        {prompts.map((prompt, index) => (
                        <div key={index}>
                            <ListItem>
                                <span onClick={() => toggleExpand(index)}>{expanded[index] ? <StyledUpIcon /> : <StyledDownIcon />}</span>
                                <span style={{fontSize: "15px"}}>{prompt.title}</span>
                            </ListItem>
                            {expanded[index] && <Details>{prompt.details}</Details>}
                            {index < prompts.length - 1 && <Separator />}
                        </div>
                        ))}
                    </OrderedList>
                </Container>

                <Container
                    header={
                    <div style={{marginBottom: "-2px", marginTop: "2px"}}>
                        <Header
                        variant="h3"
                        >
                        Sample Questions:
                        </Header> 
                    </div>               
                  }
                >
                    <hr style={{
                        backgroundColor: "lightgray", 
                        height: "1.5px",              
                        border: "none",             
                        margin: "0 0 10px 0", 
                    }} />
                    <OrderedList>
                    {questions.map((item, index) => (
                        <div key={index}>
                        <ListItem>
                            <span onClick={() => toggleExpand(index)}>{expanded[index] ? <StyledUpIcon /> : <StyledDownIcon />}</span>
                            <span style={{fontSize: "15px"}}>{item.topic}</span>
                        </ListItem>

                        {expanded[index] && (
                            <ul style={{marginTop: "1px", paddingTop: "0"}}>
                            {item.questions.map((question, qIndex) => (
                                <ListDetails key={qIndex}>
                                {question}
                                </ListDetails>
                            ))}
                            </ul>
                        )} 
                        {index < questions.length - 1 && <Separator />}
                        </div>
                    ))}
                    </OrderedList>
                </Container>
                  
              </SpaceBetween>
            </ContentLayout>
          }
        />
      );
    }
    