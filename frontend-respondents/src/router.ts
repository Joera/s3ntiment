// src/router.ts

import Navigo from 'navigo';
import { IServices } from './services.js';
import { AboutController } from './controllers/about.ctrlr.js';
import { SurveyController } from './controllers/survey.ctrlr.js';
import { LogoutController } from './components/logout.ctrlr.js';
import { CardData } from '@s3ntiment/shared';
import { parseCardURL } from '@s3ntiment/shared'
import { base } from 'viem/chains';
import { InvalidCardController } from './controllers/invalid-card-ctrlr.js';
import { UsedCardController } from './controllers/used-card-ctrlr.js';
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';
import { removeSplash } from './onpageload.js';
import { AuthController } from './controllers/auth-ctrlr.js';
import { CompletedController } from './controllers/completed-ctrlr.js';
import { AccountController } from './controllers/account-ctrlr.js';
import { resolveRootGate, resolveSurveyGate } from './router.gates.js';



const router = new Navigo('/');

let currentController: any = null;

export const initRouter = (services: IServices) => {

    router
      .on('/', 
        () => {
          if (currentController?.destroy) currentController.destroy();
          currentController = new AuthController(services);
          removeSplash();
          currentController.render();
        },
        {
          before(done, match) {
            (async () => {

              console.log("ROUTING STARTS")
              const cardData: CardData | null = await parseCardURL(window.location.href);
              const decision = await resolveRootGate(services, cardData, surveyStore);
              if (decision.navigate) {
                router.navigate(decision.navigate);
              }
              done();
            })();
          }
        }
      ).on('/invalid-card',
        () => {
          if (currentController?.destroy) currentController.destroy();
          currentController = new InvalidCardController(services);
          removeSplash();
          currentController.render();
        }
      )
      .on('/used-card/:surveyId',
        (match: any) => {
          if (currentController?.destroy) currentController.destroy();
          const surveyId = match?.params?.surveyId || match?.data?.surveyId || '';
          currentController = new UsedCardController(services, surveyId);
          removeSplash();
          currentController.render();
        }
      )
      .on('/surveys/:surveyId', 
        (match: any) => {
          if (currentController?.destroy) currentController.destroy();      
          const surveyId = match?.params?.surveyId || match?.data?.surveyId || '';
          currentController = new SurveyController(services, surveyId);
          removeSplash();
          currentController.render();
        },
        {
          before(done,match) {
            (async () => {

              console.log("ROUTING STARTS")

              const surveyId = match?.params?.surveyId || match?.data?.surveyId || '';
              const decision = await resolveSurveyGate(services, surveyStore, surveyId);
              if (decision.navigate) {
                router.navigate(decision.navigate);
              }
              done();
            })();
          }
        }
      )
      .on('/complete/:surveyId/:docId',
        (match: any) => {
          if (currentController?.destroy) currentController.destroy();
          const surveyId = match?.params?.surveyId || match?.data?.surveyId || '';
          const docId = match?.params?.docId || match?.data?.docId || '';
          currentController = new CompletedController(services, surveyId, docId);
          removeSplash();
          currentController.render();
        }
      )
      .on('/account',
        () => {
          if (currentController?.destroy) currentController.destroy();
          currentController = new AccountController(services);
          removeSplash();
          currentController.render();
        }
      )

        

       
        


//   router
//     .on('/', () => {
      
//     })
//     .before((done, match) => {
//       if (!isAuthenticated()) {
//         router.navigate('/login');
//         done(false); // false cancels the navigation
//       } else {
//         done(); // proceed
//       }
//     })
//     .on('/surveys/:surveyId', function(match) {
//       if (currentController?.destroy) currentController.destroy();      
//       const surveyId = match?.params?.surveyId || match?.data?.surveyId || '';

//       if (!surveyId) {
//         router.navigate('/surveys');
//         return;
//       }
      
//       currentController = new SurveyController(services, surveyId);
//       currentController.render();
//     })
//     .on('/logout', () => {
//       if (currentController?.destroy) currentController.destroy();
//       currentController = new LogoutController(services);
//       currentController.render();
//     })
//     .on('/about', () => {
//       if (currentController?.destroy) currentController.destroy();
//       currentController = new AboutController();
//       currentController.render();
//     })
//     .notFound(() => {
//       router.navigate('/');
//     });

  router.resolve();
};

export { router };