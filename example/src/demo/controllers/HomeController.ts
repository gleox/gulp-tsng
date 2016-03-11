module demo.controllers {
    export interface IHomeViewModel {
        greeting: string;
    }

    class HomeController implements IHomeViewModel {
        public greeting: string;

        constructor(userDetailsService: services.IUserDetailsService, greetingService: services.IGreetingService) {
            var userDetails: services.IUserDetails = userDetailsService.getUserDetails();
            this.greeting = greetingService.getMessage(userDetails.userName);
        }
    }
}