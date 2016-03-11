module demo.services {
    export interface IUserDetails {
        userName?: string;
    }

    export interface IUserDetailsService {
        getUserDetails (): IUserDetails;
    }

    class UserDetailsService implements IUserDetailsService {
        public getUserDetails () {
            return {
                    userName: "Tom"
                };
        }
    }
}