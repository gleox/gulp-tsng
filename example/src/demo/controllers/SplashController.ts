module demo.controllers {
    export interface ISplashViewModel {
        userName: string;
        message: string;
    }

    class SplashController implements ISplashViewModel {
        public message: string;
        public userName: string;

        constructor(userDetailsService: services.IUserDetailsService) {
            var userDetails: services.IUserDetails = userDetailsService.getUserDetails();
            this.userName = userDetails.userName;
            this.message = "Loading";
        }
    }
}