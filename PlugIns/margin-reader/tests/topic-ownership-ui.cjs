'use strict';
const {create}=require('./ui-session.cjs');
(async()=>{const f=await create('topic-ownership');let error;try{const output=process.env.MR_TOPIC_COVER_OUTPUT||f.output;await require('./topic-ownership-exercise.cjs').exercise({...f,output,url:f.server.url});}catch(e){error=e;}await f.finish(error);})().catch(e=>{console.error(e);process.exitCode=1;});
