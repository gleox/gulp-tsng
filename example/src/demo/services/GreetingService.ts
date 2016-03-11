module demo.services {
    export interface IGreetingService {
        getMessage(name: string): string;
    }

    class GreetingService implements IGreetingService {
        public getMessage(name: string) {
            return "Hi, " + name + "!";
        }
    }
}