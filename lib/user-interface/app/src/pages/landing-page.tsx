import React, {useEffect} from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import styled, { keyframes } from 'styled-components';

const fadeIn = keyframes`
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
`;

const PageContainer = styled.div`
    position: relative;
    background: linear-gradient(to bottom, #0c1622, rgb(2, 101, 200)); 
    width: 100vw;
    height: 100vh;
    box-sizing: border-box;
    padding: 20px 30px;
    font-family: "Open Sans", sans-serif;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    overflow: hidden;
`;

const Circle = styled.div`
    position: absolute;
    border-radius: 50%;
    z-index: 0;

    &.darkBlue {
        background-color: #05386B;
        width: 160vw;
        height: 95vw;
        bottom: -100%;
        left: -93%;
        z-index: 1;
    }

    &.lightBlue {
        background-color: rgb(24, 123, 205, 0.8);
        width: 95vw;
        height: 50vw;
        bottom: -52%;
        right: -44%;
        z-index: 0;
    }
`;

const HeaderBar = styled.div`
    display: flex;
    justify-content: end;
    align-items: center;
    width: 100%;
    position: absolute;
    top: 0;
    right: 0;
    padding: 22px 25px 0 0;
`;

const Icon = styled.img`
    height: 4.5vh;
    width: auto;
    opacity: 0.95;
`;

const SkipButton = styled.div`
    color: rgb(220, 220, 220);
    font-size: 14px;
    transition: 0.3s ease-in-out all;
    font-weight: 600;
    animation: ${fadeIn} 0.75s ease-in-out;

    &:hover {
        cursor: pointer;
        color: rgb(140, 140, 140);
    }
`;

const TextContainer = styled.div`
    font-size: 105px;
    font-weight: 700;
    color: rgb(220, 220, 220);
    padding-bottom: 0px;
    animation: ${fadeIn} 0.75s ease-in-out;
    z-index: 2;
`;

const SmallTextContainer = styled.div`
    font-size: 28px;
    font-weight: 600;
    color: rgb(220, 220, 220);
    margin-top: -10px;
    margin-bottom: 50px;
    animation: ${fadeIn} 0.75s ease-in-out;
    z-index: 2;
    transition: 0.3s ease-in-out all;

    &:hover {
        cursor: pointer;
        color: rgb(140, 140, 140);
    }
`;


const LandingPage = () => {
    const navigate = useNavigate();

    const handleSkipButtonClick = () => {
        navigate(`/chatbot/playground/${uuidv4()}`); // Navigate to the chatbot
    };

    const handleNextButtonClick = () => {
        navigate(`/about`); 
    };

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === "ArrowRight") {
                handleNextButtonClick();
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    return (
        <PageContainer>
            <HeaderBar>
                <SkipButton onClick={handleSkipButtonClick}>Skip to Chat {'>'}</SkipButton>
            </HeaderBar>
            <TextContainer>Welcome to ABE</TextContainer>
            <SmallTextContainer onClick={handleNextButtonClick}>Let's learn more about what I can do for you →</SmallTextContainer>
            <Circle className="darkBlue" />
            <Circle className="lightBlue" />
        </PageContainer>
    );
};

export default LandingPage;
